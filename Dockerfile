FROM nginx:alpine

# Copy static assets
COPY index.html app.js style.css /usr/share/nginx/html/

# Expose Nginx port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
