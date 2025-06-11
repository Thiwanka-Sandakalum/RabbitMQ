FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json .
COPY yarn.lock* .
COPY api-gateway/package.json ./api-gateway/
COPY shared/package.json ./shared/

# Install dependencies
RUN yarn install

# Copy source files
COPY shared ./shared/
COPY api-gateway ./api-gateway/

# Build shared library first
RUN cd shared && yarn build

# Build service
RUN cd api-gateway && yarn build

WORKDIR /app/api-gateway

CMD ["node", "dist/index.js"]
