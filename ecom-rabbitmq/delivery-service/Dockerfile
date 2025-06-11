FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json .
COPY yarn.lock* .
COPY delivery-service/package.json ./delivery-service/
COPY shared/package.json ./shared/

# Install dependencies
RUN yarn install

# Copy source files
COPY shared ./shared/
COPY delivery-service ./delivery-service/

# Build shared library first
RUN cd shared && yarn build

# Build service
RUN cd delivery-service && yarn build

WORKDIR /app/delivery-service

CMD ["node", "dist/index.js"]
