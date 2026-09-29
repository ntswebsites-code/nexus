# Serves the ORIGINAL static prototype (now archived in ./legacy-static).
# It is NOT the Next.js / Express / MySQL application - see README.md for that.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY legacy-static/ /usr/share/nginx/html/
EXPOSE 80
