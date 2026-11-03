import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GroupStatusResponse } from '@app/models/group-orders/group-status.model';
import { OwnerSessionResponse } from '@app/models/group-orders/owner-session.model';
import { SubmittedDish } from '@app/models/group-orders/submit-group-pre-order.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';

@Injectable({
  providedIn: 'root',
})
export class GroupOrdersService {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly http = inject(HttpClient);

  /**
   * Owner-only endpoint. The guest invite endpoint refuses full or submitted groups,
   * which the owner still has to be able to open.
   */
  getGroupInvite$(reservationId: string): Observable<GuestInvite> {
    return this.http.get<GuestInvite>(`${this.baseUrl}/reservations/${encodeURIComponent(reservationId)}/group`);
  }

  getSessions$(groupReservationId: string): Observable<GroupSessionsResponse> {
    return this.http.get<GroupSessionsResponse>(
      `${this.baseUrl}/guest/groups/${encodeURIComponent(groupReservationId)}/sessions`,
    );
  }

  getOwnerSessionId$(reservationId: string): Observable<string> {
    return this.http
      .get<OwnerSessionResponse>(`${this.baseUrl}/reservations/${encodeURIComponent(reservationId)}/guest-session-id`)
      .pipe(map(({ guestSessionId }) => guestSessionId));
  }

  getStatus$(groupReservationId: string): Observable<GroupStatusResponse> {
    return this.http.get<GroupStatusResponse>(
      `${this.baseUrl}/guest/groups/${encodeURIComponent(groupReservationId)}/status`,
    );
  }

  submit$(groupReservationId: string, reservationId: string): Observable<SubmittedDish[]> {
    return this.http.post<SubmittedDish[]>(
      `${this.baseUrl}/group-reservations/${encodeURIComponent(groupReservationId)}/submit`,
      { reservationId },
    );
  }
}
