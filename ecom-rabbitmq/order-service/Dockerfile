FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json .
COPY yarn.lock* .
COPY order-service/package.json ./order-service/
COPY shared/package.json ./shared/

# Install dependencies
RUN yarn install

# Copy source files
COPY shared ./shared/
COPY order-service ./order-service/

# Build shared library first
RUN cd shared && yarn build

# Build service
RUN cd order-service && yarn build

WORKDIR /app/order-service

CMD ["node", "dist/index.js"]
