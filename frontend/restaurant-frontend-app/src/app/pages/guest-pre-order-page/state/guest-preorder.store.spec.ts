import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GuestSessionsService } from '@app/services/guest-sessions/guest-sessions.service';
import { GuestInviteService } from '@app/services/reservation/guest-invite.service';
import { GuestPreorderStore } from './guest-preorder.store';

const TOKEN = 'invite-token';

const httpError = (status: number, errorCode?: string) =>
  throwError(() => new HttpErrorResponse({ status, error: { errorCode } }));

describe('GuestPreorderStore: invite errors', () => {
  let guestInvite: jasmine.SpyObj<GuestInviteService>;
  let guestSessions: jasmine.SpyObj<GuestSessionsService>;

  const saved = (part: string, value: string) => localStorage.setItem(`guestPreorder:${TOKEN}:${part}`, value);

  async function open(): Promise<GuestPreorderStore> {
    const store = TestBed.inject(GuestPreorderStore);
    store.initContext(TOKEN);
    await store.loadInviteByToken(TOKEN);
    return store;
  }

  beforeEach(() => {
    localStorage.clear();
    guestInvite = jasmine.createSpyObj<GuestInviteService>('GuestInviteService', ['getInvite$']);
    guestSessions = jasmine.createSpyObj<GuestSessionsService>('GuestSessionsService', ['getMenu']);
    guestSessions.getMenu.and.returnValue(of({ dishes: {} }) as ReturnType<GuestSessionsService['getMenu']>);
    TestBed.configureTestingModule({
      providers: [
        { provide: GuestInviteService, useValue: guestInvite },
        { provide: GuestSessionsService, useValue: guestSessions },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  it('tells a new guest that the group is full', async () => {
    guestInvite.getInvite$.and.returnValue(httpError(400, 'GuestLimitExceeded'));

    expect((await open()).inviteError()).toBe('full');
  });

  it('lets a joined guest with an unfinished cart back to the menu', async () => {
    guestInvite.getInvite$.and.returnValue(httpError(400, 'GuestLimitExceeded'));
    saved('guestName', 'Olena');
    saved('guestSessionId', 'session-1');
    saved('guestSessionToken', 'session-token');

    const store = await open();

    expect(store.inviteError()).toBeNull();
    expect(guestSessions.getMenu).toHaveBeenCalledWith('session-1', 'session-token');
  });

  it('treats a guest who already submitted as a new guest', async () => {
    guestInvite.getInvite$.and.returnValue(httpError(400, 'GuestLimitExceeded'));
    saved('guestSessionId', 'session-1');
    saved('guestSessionToken', 'session-token');

    expect((await open()).inviteError()).toBe('full');
  });

  it('still offers a retry for other errors, even with a saved session', async () => {
    guestInvite.getInvite$.and.returnValue(httpError(500));
    saved('guestName', 'Olena');
    saved('guestSessionId', 'session-1');
    saved('guestSessionToken', 'session-token');

    expect((await open()).inviteError()).toBe('retryable');
  });

  it('still treats 404 as an expired invite', async () => {
    guestInvite.getInvite$.and.returnValue(httpError(404));

    expect((await open()).inviteError()).toBe('expired');
  });
});
