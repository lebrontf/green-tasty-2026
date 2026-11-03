using System.ComponentModel.DataAnnotations;

namespace APIHandler.Models.GuestSessions;

public record OwnerSessionResponse(string GuestSessionId);

public record SubmittedDishResponse(string DishId, int Quantity);

public class SubmitGroupPreOrderRequest
{
    [Required]
    public string ReservationId { get; set; } = string.Empty;
}
