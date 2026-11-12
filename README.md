# HackerGerCord Push

Serviço de envio periódico de notificações Web Push para a HackerGerCord.

## Como funciona

- GitHub Actions executa o verificador a cada 5 minutos (e permite execução manual).
- O serviço consulta `publicPosts` e identifica documentos novos pelo campo numérico `id`.
- Na primeira execução, cria o cursor `_pushSystem/state` no Firestore e não envia publicações antigas.
- Nas execuções seguintes, envia novas publicações para documentos ativos em `pushSubscriptions` (`enabled == true`).
- Tokens FCM inválidos são removidos da coleção `pushSubscriptions`.
- O clique na notificação abre https://hackergercord.gersycongo.workers.dev.

## Configuração

1. No GitHub, abre Settings → Secrets and variables → Actions.
2. Cria um Repository secret chamado `FIREBASE_SERVICE_ACCOUNT`.
3. Cola no valor o conteúdo integral do JSON da conta de serviço do Firebase Admin SDK.
4. Confirma que o ficheiro JSON pertence ao projeto `hackergercord`.
5. Em Actions, executa manualmente `HackerGerCord Push` uma primeira vez. Esta primeira execução apenas inicializa o cursor.
6. A partir da execução seguinte, documentos novos com campo `id` numérico serão processados.

## Requisitos

- Firestore: coleção `publicPosts` com campo `id` numérico.
- Firestore: coleção `pushSubscriptions` com `uid`, `token`, `enabled`, `updatedAt` e `userAgent`.
- O token FCM tem de ser válido e a aplicação Web Messaging/FCM tem de estar configurada.
- O GitHub Actions tem de estar ativo no repositório.

## Plano Firebase Spark

Este projeto usa GitHub Actions como processo agendado e não requer Firebase Cloud Functions. A execução agendada do GitHub pode atrasar alguns minutos; não é instantânea.

## Segurança

Nunca coloques o JSON da conta de serviço no repositório, no HTML ou em mensagens. Guarda-o apenas no segredo `FIREBASE_SERVICE_ACCOUNT`.
