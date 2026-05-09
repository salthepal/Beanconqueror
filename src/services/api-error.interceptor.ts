import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { UIToast } from './uiToast';

@Injectable()
export class ApiErrorInterceptor implements HttpInterceptor {
  private readonly uiToast = inject(UIToast);

  public intercept(
    req: HttpRequest<any>,
    next: HttpHandler,
  ): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error?.error?.code) {
          const messageKey = this.mapCodeToMessageKey(error.error.code);
          this.uiToast.showInfoToast(messageKey, true);
        }
        return throwError(() => error);
      }),
    );
  }

  private mapCodeToMessageKey(code: string): string {
    switch (code) {
      case 'unauthorized':
        return 'API_ERROR_UNAUTHORIZED';
      case 'rate_limited':
        return 'API_ERROR_RATE_LIMITED';
      case 'idempotency_conflict':
        return 'API_ERROR_IDEMPOTENCY_CONFLICT';
      case 'gaggiuino_unavailable':
        return 'API_ERROR_GAGGIUINO_UNAVAILABLE';
      default:
        return 'API_ERROR_REQUEST_FAILED';
    }
  }
}
