/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {
  HTTP_INTERCEPTORS,
  HttpEvent,
  HttpHandler,
  HttpHeaders,
  HttpInterceptor,
  HttpRequest,
  HttpResponse
} from '@angular/common/http';
import {ApplicationRef, Injectable, NgModule, InjectionToken, Inject, Optional} from '@angular/core';
import {BrowserTransferStateModule, TransferState, makeStateKey} from '@angular/platform-browser';
import {Observable, of as observableOf} from 'rxjs';
import {tap, take, filter} from 'rxjs/operators';

export interface TransferHttpResponse {
  body?: any | null;
  headers?: {[k: string]: string[]};
  status?: number;
  statusText?: string;
  url?: string;
}

export interface TransferHttpWhitelist {
  url: string;
}

function getHeadersMap(headers: HttpHeaders) {
  const headersMap: {[name: string]: string[]} = {};
  for (const key of headers.keys()) {
    headersMap[key] = headers.getAll(key)!;
  }
  return headersMap;
}

export const TRANSFER_HTTP_WHITELIST = new InjectionToken<TransferHttpWhitelist[]>('[@nguniversal/common] whitelist');

@Injectable()
export class TransferHttpCacheInterceptor implements HttpInterceptor {

  private isCacheActive = true;

  private invalidateCacheEntry(url: string) {
    ['G', 'H', 'P'].forEach(method => this.transferState.remove(makeStateKey<TransferHttpResponse>(method + '.' + url)));
  }

  constructor(appRef: ApplicationRef, private transferState: TransferState, @Optional() @Inject(TRANSFER_HTTP_WHITELIST) private whitelist: TransferHttpWhitelist[]) {
    // Stop using the cache if the application has stabilized, indicating initial rendering is
    // complete.
    appRef.isStable
      .pipe(
        filter((isStable: boolean) => isStable),
        take(1)
      ).toPromise()
      .then(() => { this.isCacheActive = false; });
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const isMutating = this.isMutating(req);
    const isAllowed = this.isAllowed(req);

    // Stop using the cache if there is a mutating call or it's not on whitelist.
    if (isMutating || !isAllowed) {
      this.isCacheActive = false;
      this.invalidateCacheEntry(req.url);
    }

    if (!this.isCacheActive) {
      // Cache is no longer active. Pass the request through.
      return next.handle(req);
    }

    const key = this.getKey(req);
    const storeKey = makeStateKey<TransferHttpResponse>(key);

    if (this.transferState.hasKey(storeKey)) {
      // Request found in cache. Respond using it.
      const response = this.transferState.get(storeKey, {} as TransferHttpResponse);
      return observableOf(new HttpResponse<any>({
        body: response.body,
        headers: new HttpHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
        url: response.url,
      }));
    } else {
      // Request not found in cache. Make the request and cache it.
      const httpEvent = next.handle(req);
      return httpEvent
        .pipe(
          tap((event: HttpEvent<any>) => {
            if (event instanceof HttpResponse) {
              this.transferState.set(storeKey, {
                body: event.body,
                headers: getHeadersMap(event.headers),
                status: event.status,
                statusText: event.statusText,
                url: event.url!,
              });
            }
          })
        );
    }
  }

  private isAllowed(req: HttpRequest<any>): boolean {
    if (this.whitelist) {
      return this.whitelist.some(({url}) => req.url.startsWith(url));
    }

    return false;
  }

  private getKey(req: HttpRequest<any>): string {
    return req.method.substr(0, 1) + '.' + req.url;
  }

  private isMutating(req: HttpRequest<any>): boolean {
    return req.method !== 'GET' && req.method !== 'HEAD';
  }
}

/**
 * An NgModule used in conjunction with `ServerTransferHttpCacheModule` to transfer cached HTTP
 * calls from the server to the client application.
 */
@NgModule({
  imports: [BrowserTransferStateModule],
  providers: [
    TransferHttpCacheInterceptor,
    {provide: HTTP_INTERCEPTORS, useExisting: TransferHttpCacheInterceptor, multi: true},
  ],
})
export class TransferHttpCacheModule {}
