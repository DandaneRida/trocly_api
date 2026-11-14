@echo off
echo Stopping Docker Compose...
docker-compose down -v

echo.
echo Removing old volumes...
docker volume prune -f

echo.
echo Starting fresh Docker Compose...
docker-compose up -d

echo.
echo Done! Check status with: docker-compose ps
pause
