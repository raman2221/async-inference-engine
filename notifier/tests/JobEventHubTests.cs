using Notifier;
using Xunit;

public class JobEventHubTests
{
    private const string DoneEvent = """{"job_id":"a","status":"done","result":{"label":"POSITIVE","score":0.99}}""";

    [Fact]
    public async Task FinalEventCompletesEveryWaiterForThatJob()
    {
        var hub = new JobEventHub();
        using var first = hub.Register("a");
        using var second = hub.Register("a");

        hub.Dispatch(DoneEvent);

        Assert.Equal([DoneEvent, DoneEvent], [await first.Result, await second.Result]);
    }

    [Fact]
    public void FinalEventLeavesOtherJobsWaiting()
    {
        var hub = new JobEventHub();
        using var other = hub.Register("b");

        hub.Dispatch(DoneEvent);

        Assert.False(other.Result.IsCompleted);
    }

    [Fact]
    public void DeliveredJobIsNoLongerTracked()
    {
        var hub = new JobEventHub();
        using var waiter = hub.Register("a");

        hub.Dispatch(DoneEvent);

        Assert.Equal(0, hub.WaitingJobs);
    }

    [Theory]
    [InlineData("""{"job_id":"a","status":"queued"}""")]
    [InlineData("""{"status":"done"}""")]
    [InlineData("""{"job_id":"a","status":7}""")]
    [InlineData("not json")]
    public void NonFinalOrMalformedEventsAreIgnored(string eventJson)
    {
        var hub = new JobEventHub();
        using var waiter = hub.Register("a");

        hub.Dispatch(eventJson);

        Assert.False(waiter.Result.IsCompleted);
    }

    [Fact]
    public void DisposingAWaiterUnregistersIt()
    {
        var hub = new JobEventHub();
        var waiter = hub.Register("a");

        waiter.Dispose();

        Assert.Equal(0, hub.WaitingJobs);
    }

    [Theory]
    [InlineData("""{"status":"done"}""", true)]
    [InlineData("""{"status":"failed"}""", true)]
    [InlineData("""{"status":"queued"}""", false)]
    [InlineData("""{}""", false)]
    public void IsFinalRecognisesTerminalStatuses(string json, bool expected) =>
        Assert.Equal(expected, JobEventHub.IsFinal(json));
}
