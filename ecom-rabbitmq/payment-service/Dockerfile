FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json .
COPY yarn.lock* .
COPY payment-service/package.json ./payment-service/
COPY shared/package.json ./shared/

# Install dependencies
RUN yarn install

# Copy source files
COPY shared ./shared/
COPY payment-service ./payment-service/

# Build shared library first
RUN cd shared && yarn build

# Build service
RUN cd payment-service && yarn build

WORKDIR /app/payment-service

CMD ["node", "dist/index.js"]
