FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# Le process ne tourne pas en root : une faille applicative ne donne pas la main sur le
# conteneur entier. L'image node:alpine fournit l'utilisateur non privilégié `node`.
USER node

EXPOSE 4000
CMD ["node", "src/server.js"]
