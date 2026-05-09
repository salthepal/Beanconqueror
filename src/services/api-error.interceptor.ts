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
          const message = this.mapCodeToMessage(error.error.code);
          this.uiToast.showInfoToast(message, false);
        }
        return throwError(() => error);
      }),
    );
  }

  private mapCodeToMessage(code: string): string {
    switch (code) {
      case 'unauthorized':
        return 'Session expired. Reload and sign in again.';
      case 'rate_limited':
        return 'Too many requests. Please retry shortly.';
      case 'idempotency_conflict':
        return 'Request conflict detected. Retry with a new request id.';
      case 'gaggiuino_unavailable':
        return 'Gaggiuino unavailable. Verify connectivity and retry.';
      default:
        return 'Request failed. Please retry.';
    }
  }
}

