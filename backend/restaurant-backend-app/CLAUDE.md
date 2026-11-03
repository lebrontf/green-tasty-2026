# restaurant-backend-app: правила роботи з бекендом

.NET 10 Lambda за API Gateway, DynamoDB, Cognito. Деплой через EPAM Syndicate. Правила зібрані з коду станом на 03.11.2026.

**Локально бекенд не запускається:** немає Docker, LocalStack чи `dotnet run`. Локально лише збірка й unit-тести, усе інше перевіряється на розгорнутому API.

## 1. Команди

Команди для Git Bash, з цієї папки:

```bash
dotnet test restaurant-backend-app.sln --nologo -v q
```

Очікуваний результат на старті: 141 тест зелений, близько 76 старих попереджень збірки.

Деплой, лише після підтвердження людини:

```bash
export SDCT_CONF="C:/Users/Teacher/marathon-app/marathon2026-main/backend/restaurant-backend-app/.syndicate-config-restaurant-backend-app"
export PYTHONUTF8=1
S=/c/Users/Teacher/marathon-app/venv-syndicate/Scripts/syndicate.exe
"$S" build
"$S" update --deploy-name dev --replace-output --update-only-resources api-handler --update-only-resources restaurant-backend-api
```

- ⚠️ Для нових маршрутів потрібен `update`, а не `deploy`: `deploy` бачить, що API вже існує, і нічого не змінює. `update` звіряє маршрути з конфігом і **видаляє** ті, яких там немає.
- 03.11 `update` не завершився за 9 хв і був зупинений за таймаутом, хоча Lambda й маршрути вже оновились. Запускати у фоні, а результат перевіряти окремо: нові маршрути без токена мають давати 401.
- Попередні збірки лишаються в бакеті `marathon2026-restaurant-artifacts-113969923416`.
- API: `https://bxq1whqpm7.execute-api.us-west-2.amazonaws.com/develop`, регіон `us-west-2`.
- Секрети не пишемо нікуди. Репозиторій публічний.

## 2. Шлях запиту

```text
API Gateway → Function.FunctionHandler → RouteRegistry → Handler → Service → Repository → DynamoDB
```

| Шар | Папка | Що робить |
|---|---|---|
| Handler | `dnapp/lambdas/api-handler/Handlers/<Домен>/` | читає шлях, body, claims; викликає сервіс; перетворює винятки на HTTP |
| Service | `Services/<Домен>/` + інтерфейс `I...Service` | бізнес-правила, перевірка власника |
| Repository | `Repositories/<Домен>/` + `I...Repository` | лише DynamoDB |
| Entity | `Entities/` | атрибути DynamoDB |
| Model | `Models/<Домен>/` | запити й відповіді API |
| Mapper | `Mappers/` | Entity → Model |

Handler не звертається до репозиторію. Сервіс не повертає `APIGatewayProxyResponse`.

## 3. Як додати ендпоінт

Усі кроки обов'язкові:

1. **Model** запиту й відповіді в `Models/<Домен>/`.
2. **Метод сервісу** і в класі, і в інтерфейсі.
3. **Handler**, що реалізує `IApiRequestHandler`. У новому коді беремо primary constructor, як у `GetInviteTokenHandler`.
4. **Маршрут у коді:** `Routing/RouteRegistry.cs`, відповідна група, наприклад `GetGuestAndGroupRoutes`.
5. **Маршрут у Gateway:** `deployment_resources.json` у цій папці, секція `restaurant-backend-api`, блок із `enable_cors`, `authorization_type`, `lambda_name: api-handler`, `enable_proxy: true`.
6. **Новий клас сервісу чи репозиторію:** реєстрація `AddSingleton` у `RouteRegistry`. Handler реєструвати не треба.
7. **Unit-тести** сервісу в `Tests/Services/`.

⚠️ Якщо зробити крок 4 без кроку 5, Gateway поверне **403**, а не 404, і Lambda навіть не викличеться. Без кроку 4 Lambda поверне 404.

Шаблон маршруту збігається за regex, перший збіг перемагає. Параметр `{id}` читається через `request.TryGetPathValue("id", out var id)`.

## 4. Авторизація

| `authorization_type` | Хто | Як перевірити |
|---|---|---|
| `cognito_authorizer` | зареєстрований користувач | `UserContextHelper.GetAuthenticatedUserId(request)` (claim `sub`); якщо `null`, 401 |
| `NONE` + гостьовий токен | гість групи | `IGuestAuthorizationService.ValidateAsync`, заголовок `Authorization: Bearer <token>` |
| `NONE` | публічні дані | немає |

- Власник бронювання: `reservation.CustomerId == userId`. Інакше `ActionForbiddenException` (403).
- `cognito_authorizer` лише підтверджує вхід, а **не власника**. Власника завжди перевіряємо в сервісі.

## 5. Помилки

Винятки кидає сервіс, ловить handler:

| Виняток | HTTP | Як відповісти |
|---|---|---|
| `GroupReservationNotFoundException`, `ReservationNotFoundException`, `GuestSessionNotFoundException` | 404 | `CreateErrorResponse(404, ex.Message, context.Logger)` |
| `ActionForbiddenException` | 403 | `CreateErrorResponse(403, ...)` |
| `ValidationException` | 400 | `CreateErrorCodeResponse(ex)` |
| будь-який інший | 500 | ловить `Function` |

⚠️ NotFound-винятки успадковані від `ValidationException`, тому в `catch` вони мають стояти **першими**. `ActionForbiddenException` не успадковується від `ValidationException`.

⚠️ `GroupReservationService.GetGroupReservationAsync` кидає `InvalidOperationException`, тобто дає **500**. Там, де потрібен 404, беремо репозиторій і кидаємо `GroupReservationNotFoundException`.

## 6. Формат JSON

| Метод | Назви полів |
|---|---|
| `ResponseBuilder.CreateJsonResponse(200, body)` | **camelCase** |
| `ResponseBuilder.CreateSuccessResponse(body)` | **як у C#** (PascalCase), якщо немає `JsonPropertyName` |

- Нові ендпоінти групового замовлення віддають відповідь через `CreateJsonResponse`, бо контракт у `homework-backend.md` і моделі фронтенду в camelCase.
- ⚠️ `DeleteGuestSessionHandler` використовує `CreateSuccessResponse`, а `Participant` без `JsonPropertyName`, тож `DELETE` повертає `Participants`, `Total` (ймовірна невідповідність контракту). Виправити, якщо екран почне його використовувати.
- `GuestInvite` на фронтенді справді в PascalCase. Дивимось на наявну модель, а не вгадуємо.
- Enum у відповіді як текст: `JsonStringEnumConverter<T>`. Enum у DynamoDB як число: `EnumAsIntConverter<T>`.
- Body запиту: `RequestBodyHelper.TryParseAndValidate<T>`.

## 7. DynamoDB

- Назви таблиць беремо лише з `Constants/ResourceNames.cs`, індексів з `Constants/GlobalIndexNames.cs`.
- Кожен виклик передає `OverrideTableName`, зручно через `Constants/DynamoConfig.cs`.
- Нова таблиця чи змінна: `deployment_resources.json`, `lambda_config.json`, `syndicate_aliases.yml`, `ResourceNames.cs`.
- ⚠️ Запити через GSI читають дані з затримкою. Одразу після запису чи видалення список може бути застарілим. Не покладаємось на нього, а локально враховуємо власну зміну.
- ⚠️ Транзакцій немає: кілька `SaveAsync` не атомарні. Порядок записів обираємо так, щоб після збою дію можна було повторити.

## 8. Групове замовлення

### Домен
- `GroupReservation` створюється в `CreateReservationAsync` лише при `GuestCount >= 2`, зі статусом `Open`. Статуси: `Open`, `Submitted`, `Closed`.
- `GuestSession` це кошик учасника, поле `IsSubmitted`. Страви в `Dishes` типу `OrderItem`.
- `Order` створюється лише через `POST /orders`, тому **може не існувати**. `GetOrderByReservationIdAsync` пропускає скасовані замовлення.
- Статуси `Order`: `Created`, `Submitted`, `Cancelled`, `SubmittedByCustomer`.

### Ендпоінти
- **Гість:** `POST /guest/sessions`, `GET /guest/sessions/{id}`, страви, submit кошика, меню, `GET /guest/groups/{id}/status`, `GET /guest/invites/{token}`.
- **Власник:** `GET /reservations/{id}/invite-token`, `GET /reservations/{id}/group`, `GET /reservations/{id}/guest-session-id`, `GET /guest/groups/{id}/sessions`, `POST /group-reservations/{id}/submit`, `DELETE /guest/groups/{id}/sessions/{sessionId}`.
- `GET /reservations/{id}/group` немає в завданні. Він потрібен, бо `GET /guest/invites/{token}` відмовляє, коли група заповнена або вже підтверджена, а власник має відкривати екран і тоді.

⚠️ `token.interceptor.ts` на фронтенді не додає токен до адрес із `/guest/`, крім `/guest/groups/{id}/sessions`. Новий ендпоінт для власника під `/guest/` потребує такого ж винятку.

**Джерело контракту:** `homework-backend.md` і `models/group-orders/` фронтенду. У `swagger-endpoints.yaml` шлях submit інший (`/guest/groups/{id}/submit`), на нього не орієнтуємось.

### Правила submit
1. Лише власник. Немає бронювання чи групи: 404.
2. Беремо лише сесії з `IsSubmitted`. Немає жодної: 400. Немає жодної страви: 400.
3. Об'єднуємо страви за `dishId`, сумуємо `quantity`.
4. Немає `Order`: створюємо його. **Це навмисне відхилення від завдання** (там 400), щоб власнику не був потрібен окремий pre-order. Сповіщення офіціанту при цьому не надсилається.
5. Додаємо страви в order, статус `SubmittedByCustomer`, потім група `Submitted`.
6. Відповідь: масив `{ dishId, quantity }`.

### ⚠️ Пастки
- **Сесія власника** створюється при першому `guest-session-id` з фіксованим id `owner-{groupReservationId}`, щоб повторні виклики не робили другу. Вона має `IsSubmitted = true`, бо власного кошика поки немає, і не рахується в ліміт гостей.
- **Сесія без токена.** В owner session немає `SessionTokenHash`, а гостьові ендпоінти перевіряють токен, тому власник не наповнює кошик через них.
- **Повтор submit.** Замовлення зберігається раніше за статус групи, без транзакції. Якщо другий запис упаде, повторний submit подвоїть кількість страв.
- **Групи для старих бронювань.** До виправлення `PUT /reservations` не створював групу, для таких бронювань екран покаже «не знайдено», доки їх не змінити ще раз.
- **Опечатка в Gateway.** У `deployment_resources.json` лишився `GET /guest/group/{id}/sessions` в однині без обробника. Робочий маршрут у множині.
- **Нові залежності в конструкторі.** Тести створюють `GuestSessionService` вручну, тому нова залежність вимагає правок і в `Tests/`.
- **Видалена страва.** `dishesById[d.DishId]` падає, якщо страви вже немає. У новому коді не повторювати без перевірки.

## 9. Тести

- xUnit, Moq, AutoFixture (`[Theory, AutoData]`). Папка `Tests/Services/`.
- Назва: `Метод_Умова_ОчікуванийРезультат`.
- Для нового ендпоінта: успіх, чужий користувач (403), не знайдено (404), порожні дані (400).
- Unit-тести не перевіряють маршрути Gateway і формат JSON. Після деплою перевіряємо на реальному API.

## 10. Чого не чіпаємо

- Не перейменовуємо наявне заради порядку: `CreatGuestSessionResponse`, простір імен `Function.Services`, `Handlers.GuestReservations`, `Models.GuestReservation`. Такі правки ламають зайві місця.
- Існуючі маршрути й контракти лишаються без змін, бо від них залежить робочий застосунок.
- Не розширюємо `lambda-basic-execution` і `AdministratorAccess`, якщо цього не вимагає задача.
- Не змінюємо дані в DynamoDB без підтвердження людини. Записи `placeholder-waiter-*` у `Waiters` навмисні: без них бронювання падає.

## 11. Відомі проблеми (поза межами фічі)

- `GET /reservations/{id}/invite-token` не перевіряє власника: будь-який увійшлий користувач із відомим id отримає токен. Також `(await ...)!` дасть 500, якщо групи немає (бронювання на 1 гостя відсікається раніше, але старі дані можуть не мати групи).
- `DefaultHeaders` у `ResponseBuilder` не містить `PATCH` у `Access-Control-Allow-Methods`.
- Lambda на 128 MB: перший запит після простою займає кілька секунд, бо `RouteRegistry` створює всі обробники на старті.
