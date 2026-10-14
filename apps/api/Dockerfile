FROM node:24-alpine

WORKDIR /app

# Times are kept in UTC and turned into Namibia time in code (utils/appointmentTime);
# a few date helpers use the process's local time, so pin it.
ENV TZ=UTC

COPY package*.json ./

# Exactly the lockfile, without the test tools (jest, nodemon, the in-memory database).
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Not root: the API only reads its own files and listens on 5000.
USER node

EXPOSE 5000

# node directly (not npm start), so SIGTERM reaches the graceful shutdown in server.js.
CMD ["node", "server.js"]
