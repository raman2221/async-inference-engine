using Notifier;

// Result-delivery service: clients open ws://.../ws/jobs/{id} and the result
// is pushed the moment the worker finishes, instead of the client polling.
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddNotifier(builder.Configuration);

var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
app.MapNotifierEndpoints();
app.Run();

// Lets the integration tests start the app with WebApplicationFactory<Program>.
public partial class Program;
