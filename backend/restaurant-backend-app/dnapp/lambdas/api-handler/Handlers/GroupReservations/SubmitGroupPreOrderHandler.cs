using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Exceptions;
using APIHandler.Helpers;
using APIHandler.Models.GuestSessions;
using APIHandler.Services.GuestSessions;
using System.Threading.Tasks;

namespace APIHandler.Handlers.GroupReservations;

public class SubmitGroupPreOrderHandler(IGuestSessionService service) : IApiRequestHandler
{
    public async Task<APIGatewayProxyResponse> HandleRequest(APIGatewayProxyRequest request, ILambdaContext context)
    {
        if (!request.TryGetPathValue("groupReservationId", out string? groupReservationId))
            return ResponseBuilder.CreateErrorResponse(400, "Missing 'groupReservationId' in path parameters.", context.Logger);

        string? userId = UserContextHelper.GetAuthenticatedUserId(request);
        if (userId is null)
            return ResponseBuilder.CreateErrorResponse(401, "Unauthorized.", context.Logger);

        if (!RequestBodyHelper.TryParseAndValidate(request, context, out SubmitGroupPreOrderRequest? body, out var errorResponse))
            return errorResponse;

        try
        {
            return ResponseBuilder.CreateJsonResponse(
                200,
                await service.SubmitGroupPreOrderAsync(userId, groupReservationId, body.ReservationId));
        }
        catch (GroupReservationNotFoundException exception)
        {
            return ResponseBuilder.CreateErrorResponse(404, exception.Message, context.Logger);
        }
        catch (ReservationNotFoundException exception)
        {
            return ResponseBuilder.CreateErrorResponse(404, exception.Message, context.Logger);
        }
        catch (ActionForbiddenException exception)
        {
            return ResponseBuilder.CreateErrorResponse(403, exception.Message, context.Logger);
        }
        catch (ValidationException exception)
        {
            return ResponseBuilder.CreateErrorCodeResponse(exception);
        }
    }
}
