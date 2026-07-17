docker stop durindoor
docker rm durindoor
docker build -t durindoor .
docker run -d --name durindoor -p 20128:20128 --env-file .env -v durindoor-data:/app/data durindoor