FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Notifier.csproj ./
RUN dotnet restore
COPY src/ ./
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out ./
ENV ASPNETCORE_URLS=http://+:8081
EXPOSE 8081
USER app
ENTRYPOINT ["dotnet", "Notifier.dll"]
