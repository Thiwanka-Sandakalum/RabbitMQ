FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json .
COPY yarn.lock* .
COPY notification-service/package.json ./notification-service/
COPY shared/package.json ./shared/

# Install dependencies
RUN yarn install

# Copy source files
COPY shared ./shared/
COPY notification-service ./notification-service/

# Build shared library first
RUN cd shared && yarn build

# Build service
RUN cd notification-service && yarn build

WORKDIR /app/notification-service

CMD ["node", "dist/index.js"]
