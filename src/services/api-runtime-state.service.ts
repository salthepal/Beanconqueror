import { Injectable } from '@angular/core';

import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ApiRuntimeStateService {
  private readonly staleSubject = new BehaviorSubject<boolean>(false);
  public readonly stale$ = this.staleSubject.asObservable();

  public markStale(): void {
    this.staleSubject.next(true);
  }

  public clearStale(): void {
    this.staleSubject.next(false);
  }

  public isStaleSnapshot(): boolean {
    return this.staleSubject.value;
  }
}

