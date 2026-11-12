const admin = require("firebase-admin");

const SITE_URL = "https://hackergercord.gersycongo.workers.dev";
const PROJECT_ID = "hackergercord";
const POSTS_COLLECTION = "publicPosts";
const SUBSCRIPTIONS_COLLECTION = "pushSubscriptions";
const STATE_DOC = "_pushSystem/state";
const PAGE_SIZE = 100;
const TOKEN_BATCH_SIZE = 500;

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("Falta o segredo FIREBASE_SERVICE_ACCOUNT nas GitHub Actions secrets.");
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("O segredo FIREBASE_SERVICE_ACCOUNT não contém JSON válido.");
  }

  if (credentials.project_id !== PROJECT_ID) {
    throw new Error(
      `O JSON pertence ao projeto "${credentials.project_id}", mas era esperado "${PROJECT_ID}".`
    );
  }

  return credentials;
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function notificationContent(data) {
  const kind = asText(data.kind || data.type) || "publicação";
  const title =
    asText(data.title) ||
    asText(data.name) ||
    asText(data.cat) ||
    "Nova publicação na HackerGerCord";

  const description =
    asText(data.desc) ||
    asText(data.description) ||
    asText(data.text);

  const body = description
    ? description.slice(0, 180)
    : `Há novidades na secção ${asText(data.section) || kind} da HackerGerCord.`;

  return {
    title: `HackerGerCord · ${title}`.slice(0, 180),
    body,
    data: {
      kind: String(kind).slice(0, 100),
      postId: String(data.id ?? ""),
      url: SITE_URL
    }
  };
}

async function getEnabledSubscriptions(db) {
  const snapshot = await db
    .collection(SUBSCRIPTIONS_COLLECTION)
    .where("enabled", "==", true)
    .get();

  const valid = [];
  for (const doc of snapshot.docs) {
    const token = asText(doc.get("token"));
    if (token) valid.push({ ref: doc.ref, token });
  }
  return valid;
}

async function sendToAll(db, content) {
  const subscriptions = await getEnabledSubscriptions(db);

  if (subscriptions.length === 0) {
    console.log("Nenhuma subscrição push ativa. A publicação será marcada como processada.");
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidRefs = [];

  for (let i = 0; i < subscriptions.length; i += TOKEN_BATCH_SIZE) {
    const batch = subscriptions.slice(i, i + TOKEN_BATCH_SIZE);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batch.map(item => item.token),
      notification: {
        title: content.title,
        body: content.body
      },
      data: content.data,
      webpush: {
        notification: {
          title: content.title,
          body: content.body,
          requireInteraction: false
        },
        fcmOptions: {
          link: SITE_URL
        }
      }
    });

    successCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((result, index) => {
      if (result.success) return;

      const code = result.error?.code || "unknown";
      console.warn(`Falha num token (${code}).`);

      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        invalidRefs.push(batch[index].ref);
      }
    });
  }

  if (invalidRefs.length) {
    const chunks = [];
    for (let i = 0; i < invalidRefs.length; i += 450) {
      chunks.push(invalidRefs.slice(i, i + 450));
    }
    for (const refs of chunks) {
      const writeBatch = db.batch();
      refs.forEach(ref => writeBatch.delete(ref));
      await writeBatch.commit();
    }
  }

  console.log(
    `Envio concluído: ${successCount} sucesso(s), ${failureCount} falha(s), ` +
    `${invalidRefs.length} token(s) inválido(s) removido(s).`
  );
}

async function bootstrapCursor(db, stateRef) {
  const newest = await db
    .collection(POSTS_COLLECTION)
    .orderBy("id", "desc")
    .limit(1)
    .get();

  let maxId = 0;
  if (!newest.empty) {
    const value = newest.docs[0].get("id");
    if (typeof value === "number" && Number.isFinite(value)) {
      maxId = value;
    } else if (typeof value === "bigint") {
      maxId = Number(value);
    }
  }

  await stateRef.create({
    lastId: maxId,
    initializedAt: admin.firestore.FieldValue.serverTimestamp(),
    note: "Cursor inicial: publicações anteriores não são notificadas."
  });

  console.log(
    `Primeira execução: cursor inicializado em ${maxId}. ` +
    "As publicações antigas não serão enviadas."
  );
}

async function main() {
  const credentials = loadServiceAccount();

  admin.initializeApp({
    credential: admin.credential.cert(credentials),
    projectId: PROJECT_ID
  });

  const db = admin.firestore();
  const stateRef = db.doc(STATE_DOC);
  let state = await stateRef.get();

  if (!state.exists) {
    await bootstrapCursor(db, stateRef);
    return;
  }

  let lastId = Number(state.get("lastId") || 0);
  if (!Number.isFinite(lastId)) {
    throw new Error("O cursor guardado em _pushSystem/state não é válido.");
  }

  let processed = 0;

  while (true) {
    const posts = await db
      .collection(POSTS_COLLECTION)
      .where("id", ">", lastId)
      .orderBy("id", "asc")
      .limit(PAGE_SIZE)
      .get();

    if (posts.empty) break;

    for (const post of posts.docs) {
      const data = post.data();
      const numericId = Number(data.id);

      if (!Number.isFinite(numericId)) {
        console.warn(`Documento ${post.id} ignorado: campo id não numérico.`);
        continue;
      }

      const content = notificationContent(data);
      console.log(`Nova publicação detetada: ${content.title}`);

      await sendToAll(db, content);

      // Só avançar depois de terminar o envio desta publicação.
      await stateRef.set({
        lastId: numericId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      lastId = numericId;
      processed += 1;
    }

    if (posts.size < PAGE_SIZE) break;
  }

  console.log(`Verificação terminada. ${processed} publicação(ões) processada(s).`);
}

main().catch(error => {
  console.error("Erro no serviço de notificações:", error);
  process.exitCode = 1;
});
