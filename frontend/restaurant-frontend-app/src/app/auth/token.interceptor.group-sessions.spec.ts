import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ToastService } from '../services/toast/toast.service';
import { AuthenticationService } from './services/authentication.service';
import { SKIP_ERROR_TOAST } from './skip-error-toast.context';
import { tokenInterceptor } from './token.interceptor';

describe('tokenInterceptor: owner group sessions', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  const authorizationFor = (url: string): string | null => {
    http.get(url).subscribe();
    const request = controller.expectOne(url);
    const header = request.request.headers.get('Authorization');
    request.flush({});
    return header;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthenticationService, useValue: { getTokens: () => ({ idToken: 'user-token' }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('adds the user token to ordinary requests', () => {
    expect(authorizationFor('https://api.test/reservations')).toBe('Bearer user-token');
  });

  it('adds the user token to the owner group sessions list', () => {
    expect(authorizationFor('https://api.test/guest/groups/grp-1/sessions')).toBe('Bearer user-token');
  });

  it('adds the user token when the owner removes a guest session', () => {
    expect(authorizationFor('https://api.test/guest/groups/grp-1/sessions/guest-1')).toBe('Bearer user-token');
  });

  it('leaves guest endpoints without the user token', () => {
    expect(authorizationFor('https://api.test/guest/sessions/guest-1/menu')).toBeNull();
    expect(authorizationFor('https://api.test/guest/groups/grp-1/status')).toBeNull();
    expect(authorizationFor('https://api.test/guest/invites/token')).toBeNull();
  });

  describe('guest endpoint errors', () => {
    const url = 'https://api.test/guest/invites/token';
    const failWith400 = (context?: HttpContext) => {
      http.get(url, { context }).subscribe({ error: () => undefined });
      controller.expectOne(url).flush({ message: 'Guest limit exceeded' }, { status: 400, statusText: 'Bad Request' });
    };

    it('shows a toast by default', () => {
      failWith400();

      expect(TestBed.inject(ToastService).error).toHaveBeenCalled();
    });

    it('stays silent when the caller handles the error itself', () => {
      failWith400(new HttpContext().set(SKIP_ERROR_TOAST, true));

      expect(TestBed.inject(ToastService).error).not.toHaveBeenCalled();
    });
  });
});
