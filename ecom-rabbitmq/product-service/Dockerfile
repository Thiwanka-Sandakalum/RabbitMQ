FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json .
COPY yarn.lock* .
COPY product-service/package.json ./product-service/
COPY shared/package.json ./shared/

# Install dependencies
RUN yarn install

# Copy source files
COPY shared ./shared/
COPY product-service ./product-service/

# Build shared library first
RUN cd shared && yarn build

# Build service
RUN cd product-service && yarn build

WORKDIR /app/product-service

CMD ["node", "dist/index.js"]
