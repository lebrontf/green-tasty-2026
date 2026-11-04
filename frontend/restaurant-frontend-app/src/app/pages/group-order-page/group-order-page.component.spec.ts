// Рівень 2 · сторінка на даних з API. Сервіс підмінено шпигуном — у мережу тест не ходить.
// Запуск: npm run test:hw
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { ToastService } from '@app/services/toast/toast.service';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GroupOrderPageComponent } from './group-order-page.component';

const caesar = { id: 'dish1', name: 'Caesar Salad', price: 180 };
const tomYum = { id: 'dish2', name: 'Tom Yum', price: 220 };

const SESSIONS: GroupSessionsResponse = {
  participants: [
    { id: 'owner', type: 'Owner', name: 'Yevhenii', isSubmitted: true, total: 180, items: [{ dish: caesar, quantity: 1 }] },
    { id: 'andrii', type: 'Guest', name: 'Andrii', isSubmitted: true, total: 360, items: [{ dish: caesar, quantity: 2 }] },
    { id: 'olena', type: 'Guest', name: 'Olena', isSubmitted: false, total: 220, items: [{ dish: tomYum, quantity: 1 }] },
  ],
  total: 760,
};
const INVITE = {
  GroupReservationId: 'grp-1',
  LocationAddress: 'Rustaveli Avenue 48',
  MaxGuestCount: 5,
  StartTime: '2026-10-21T16:00:00Z',
  EndTime: '2026-10-21T17:30:00Z',
} as GuestInvite;

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

describe('Рівень 2 · сторінка Owner Review', () => {
  let service: jasmine.SpyObj<GroupOrdersService>;
  let guestInvite: jasmine.SpyObj<GuestInviteService>;

  function create() {
    TestBed.configureTestingModule({
      imports: [GroupOrderPageComponent],
      providers: [
        { provide: GroupOrdersService, useValue: service },
        { provide: GuestInviteService, useValue: guestInvite },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ reservationId: 'res-1' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(GroupOrderPageComponent);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<GroupOrdersService>('GroupOrdersService', [
      'getGroupInvite$', 'getSessions$', 'getOwnerSessionId$', 'getStatus$', 'submit$',
    ]);
    guestInvite = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', ['getInviteToken$']);
    guestInvite.getInviteToken$.and.returnValue(of({ token: 'abc123' }));
    service.getGroupInvite$.and.returnValue(of(INVITE));
    service.getSessions$.and.returnValue(of(structuredClone(SESSIONS)));
    service.getOwnerSessionId$.and.returnValue(of('owner'));
    service.getStatus$.and.returnValue(of({ currentParticipants: 3, maxCapacity: 5, status: 'Open' as const }));
  });

  describe('дані', () => {
    it('бере reservationId з адреси і вантажить групу за GroupReservationId', () => {
      create();
      expect(service.getGroupInvite$).toHaveBeenCalledWith('res-1');
      expect(service.getSessions$.calls.mostRecent().args[0]).toBe('grp-1');
    });

    it('показує всіх учасників; власна картка — «My Pre-Order»', () => {
      const { element } = create();
      expect(element.querySelectorAll('app-participant-card').length).toBe(3);
      expect(element.textContent).toContain('My Pre-Order');
      expect(element.textContent).toContain('Guest: Andrii');
    });

    it('бейдж статусу: «Collecting pre-orders»', () => {
      expect(create().element.textContent).toContain('Collecting pre-orders');
    });
  });

  describe('консолідоване замовлення — головна пастка', () => {
    it('Grand Total рахує лише підтверджені кошики: $540, а не $760 з API', () => {
      const text = create().element.textContent ?? '';
      expect(text).toContain('$540.00');
      expect(text).not.toContain('$760.00');
    });

    it('однакові страви — одним рядком: «Caesar Salad × 3»', () => {
      expect(create().element.textContent).toContain('Caesar Salad × 3');
    });

    it('жовта плашка: «1 participant hasn’t submitted…»', () => {
      expect(create().element.textContent).toMatch(/1 participant hasn.t submitted/);
    });
  });

  describe('стани екрана', () => {
    it('порожньо: «Participants haven’t added any dishes yet»', () => {
      const empty = structuredClone(SESSIONS);
      empty.participants.forEach((p) => (p.items = []));
      service.getSessions$.and.returnValue(of(empty));
      expect(create().element.textContent).toMatch(/Participants haven.t added any dishes yet/);
    });

    it('404: «Group reservation not found»', () => {
      service.getGroupInvite$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      expect(create().element.textContent).toContain('Group reservation not found');
    });

    it('інша помилка: кнопка «Try again» вантажить ще раз', () => {
      service.getGroupInvite$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { fixture, element } = create();
      buttonByText(element, 'Try again')?.click();
      fixture.detectChanges();
      expect(service.getGroupInvite$).toHaveBeenCalledTimes(2);
    });
  });

  describe('Invite Link', () => {
    const copyButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[aria-label="Copy invite link"]');

    it('показує посилання, поки група відкрита', () => {
      const { element } = create();

      expect(guestInvite.getInviteToken$).toHaveBeenCalledWith('res-1');
      expect(element.querySelector<HTMLInputElement>('#group-invite-link')?.value).toBe(`${window.location.origin}/join/abc123`);
    });

    it('копіює посилання і показує toast', async () => {
      const writeText = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const { fixture, element } = create();
      const toast = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>;

      copyButton(element)!.click();
      await fixture.whenStable();

      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/abc123`);
      expect(toast.success).toHaveBeenCalledWith('Share it with your friends.', 'Link copied!');
    });

    it('показує помилку, якщо скопіювати не вдалось', async () => {
      spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('denied'));
      const { fixture, element } = create();
      const toast = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>;

      copyButton(element)!.click();
      await fixture.whenStable();

      expect(toast.error).toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('не запитує посилання, коли замовлення вже надіслано', () => {
      service.getStatus$.and.returnValue(of({ currentParticipants: 3, maxCapacity: 5, status: 'Submitted' as const }));
      const { element } = create();

      expect(guestInvite.getInviteToken$).not.toHaveBeenCalled();
      expect(copyButton(element)).toBeNull();
    });

    it('екран працює, навіть якщо посилання не завантажилось', () => {
      guestInvite.getInviteToken$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { element } = create();

      expect(copyButton(element)).toBeNull();
      expect(buttonByText(element, 'Submit Pre-Order')).toBeDefined();
    });
  });

  describe('Submit Pre-Order', () => {
    it('кнопка неактивна, якщо ніхто не підтвердив кошик', () => {
      const nobody = structuredClone(SESSIONS);
      nobody.participants.forEach((p) => (p.isSubmitted = false));
      service.getSessions$.and.returnValue(of(nobody));
      expect(buttonByText(create().element, 'Submit Pre-Order')?.disabled).toBeTrue();
    });

    it('«Submit Pre-Order» → діалог → «Submit»: запит іде один раз навіть при подвійному кліку', () => {
      const response$ = new Subject<{ dishId: string; quantity: number }[]>();
      service.submit$.and.returnValue(response$);
      const { fixture, element } = create();

      buttonByText(element, 'Submit Pre-Order')?.click();
      fixture.detectChanges();
      const dialog = element.querySelector('[role="dialog"]');
      expect(dialog).withContext('має відкритись <app-modal>').not.toBeNull();

      buttonByText(dialog!, 'Submit')?.click();
      fixture.detectChanges();
      buttonByText(dialog!, 'Submit')?.click();
      buttonByText(dialog!, 'Submitting…')?.click();
      fixture.detectChanges();

      expect(service.submit$).toHaveBeenCalledOnceWith('grp-1', 'res-1');
    });

    it('після успіху: «Sent to Restaurant», кнопки Submit більше немає', () => {
      service.submit$.and.returnValue(of([{ dishId: 'dish1', quantity: 3 }]));
      const { fixture, element } = create();
      buttonByText(element, 'Submit Pre-Order')?.click();
      fixture.detectChanges();
      buttonByText(element.querySelector('[role="dialog"]')!, 'Submit')?.click();
      fixture.detectChanges();

      expect(element.textContent).toContain('Sent to Restaurant');
      expect(buttonByText(element, 'Submit Pre-Order')).toBeUndefined();
    });

    it('помилка submit: екран не ламається, кнопку можна натиснути знову', () => {
      service.submit$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
      const { fixture, element } = create();
      buttonByText(element, 'Submit Pre-Order')?.click();
      fixture.detectChanges();
      buttonByText(element.querySelector('[role="dialog"]')!, 'Submit')?.click();
      fixture.detectChanges();

      expect(buttonByText(element, 'Submit Pre-Order')?.disabled).toBeFalse();
    });
  });
});
