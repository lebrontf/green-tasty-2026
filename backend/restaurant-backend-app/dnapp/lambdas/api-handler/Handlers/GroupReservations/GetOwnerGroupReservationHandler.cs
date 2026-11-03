using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Exceptions;
using APIHandler.Helpers;
using APIHandler.Services.GroupReservations;
using System.Threading.Tasks;

namespace APIHandler.Handlers.GroupReservations;

public class GetOwnerGroupReservationHandler(IGroupReservationService service) : IApiRequestHandler
{
    public async Task<APIGatewayProxyResponse> HandleRequest(APIGatewayProxyRequest request, ILambdaContext context)
    {
        if (!request.TryGetPathValue("reservationId", out string? reservationId))
            return ResponseBuilder.CreateErrorResponse(400, "Missing 'reservationId' in path parameters.", context.Logger);

        string? userId = UserContextHelper.GetAuthenticatedUserId(request);
        if (userId is null)
            return ResponseBuilder.CreateErrorResponse(401, "Unauthorized.", context.Logger);

        try
        {
            return ResponseBuilder.CreateSuccessResponse(await service.GetGroupReservationForOwnerAsync(userId, reservationId));
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
