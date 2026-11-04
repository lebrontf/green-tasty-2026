import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, map, switchMap } from 'rxjs';
import { ParticipantCardComponent } from '@app/components/group-orders/participant-card/participant-card.component';
import { GroupReservationStatus } from '@app/models/group-orders/group-status.model';
import { Participant } from '@app/models/group-orders/participant.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';
import { copyInputValue } from '@app/shared/helpers/copy-input-value';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

const STATUS_LABELS: Record<GroupReservationStatus, string> = {
  Open: 'Collecting pre-orders',
  Submitted: 'Sent to Restaurant',
  Closed: 'Closed',
};

@Component({
  selector: 'app-group-order-page',
  imports: [CurrencyPipe, DatePipe, ModalComponent, ParticipantCardComponent],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class GroupOrderPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(GroupOrdersService);
  private readonly guestInviteService = inject(GuestInviteService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly reservationId = this.route.snapshot.paramMap.get('reservationId') ?? '';

  readonly state = signal<LoadState>('loading');
  readonly invite = signal<GuestInvite | null>(null);
  readonly participants = signal<Participant[]>([]);
  readonly ownerSessionId = signal<string | null>(null);
  readonly status = signal<GroupReservationStatus>('Open');
  readonly confirmOpen = signal(false);
  readonly submitting = signal(false);
  readonly inviteLink = signal<string | null>(null);

  // Only submitted carts go to the restaurant, so this is not the API's own total.
  readonly consolidated = computed(() => consolidatePreOrder(this.participants()));
  readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);
  readonly isOpen = computed(() => this.status() === 'Open');
  readonly hasAnyDishes = computed(() => this.participants().some((person) => person.items.length > 0));
  readonly canSubmit = computed(() => this.consolidated().items.length > 0 && !this.submitting());
  readonly pendingCount = computed(
    () => this.participants().filter((person) => !person.isSubmitted && person.type === 'Guest').length,
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state.set('loading');

    this.service
      .getGroupInvite$(this.reservationId)
      .pipe(
        // The owner session is created on first request, so it has to exist before the list is read.
        switchMap((invite) =>
          this.service.getOwnerSessionId$(this.reservationId).pipe(map((ownerSessionId) => ({ invite, ownerSessionId }))),
        ),
        switchMap(({ invite, ownerSessionId }) =>
          forkJoin({
            sessions: this.service.getSessions$(invite.GroupReservationId),
            groupStatus: this.service.getStatus$(invite.GroupReservationId),
          }).pipe(map(({ sessions, groupStatus }) => ({ invite, ownerSessionId, sessions, groupStatus }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ invite, ownerSessionId, sessions, groupStatus }) => {
          this.invite.set(invite);
          this.ownerSessionId.set(ownerSessionId);
          this.participants.set(sessions.participants);
          this.status.set(groupStatus.status);
          this.state.set('ready');
          if (groupStatus.status === 'Open') {
            this.loadInviteLink();
          }
        },
        error: (error: HttpErrorResponse) => {
          this.state.set(error.status === 404 ? 'not-found' : 'error');
        },
      });
  }

  async copyInviteLink(input: HTMLInputElement): Promise<void> {
    try {
      await copyInputValue(input);
      this.toast.success('Share it with your friends.', 'Link copied!');
    } catch {
      this.toast.error('Could not copy the link. Please copy it manually.');
    }
  }

  // Fetched up front because the copy command has to run directly in the click handler.
  private loadInviteLink(): void {
    this.guestInviteService
      .getInviteToken$(this.reservationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ token }) => this.inviteLink.set(`${window.location.origin}/join/${token}`),
        // tokenInterceptor already shows the API's message; the rest of the screen still works.
        error: () => this.inviteLink.set(null),
      });
  }

  openConfirm(): void {
    if (this.canSubmit()) {
      this.confirmOpen.set(true);
    }
  }

  closeConfirm(): void {
    if (!this.submitting()) {
      this.confirmOpen.set(false);
    }
  }

  submit(): void {
    const invite = this.invite();
    if (!invite || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.service
      .submit$(invite.GroupReservationId, this.reservationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.confirmOpen.set(false);
          this.status.set('Submitted');
          this.toast.success('Pre-order sent to the restaurant');
        },
        // tokenInterceptor already shows the API's message as a toast.
        error: () => {
          this.submitting.set(false);
          this.confirmOpen.set(false);
        },
      });
  }
}
