
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { randomBytes, scryptSync } = require("node:crypto");

admin.initializeApp();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 2,
});

const ADMIN_UID = "V5xQVI6gTYg27rMOELKX2hthiB63";

exports.createFamilyProfile = onCall(
  {
    cors: true,
    maxInstances: 2,
  },
  async (request) => {
    if (!request.auth || request.auth.uid !== ADMIN_UID) {
      throw new HttpsError(
        "permission-denied",
        "Solo la administradora puede registrar perfiles."
      );
    }

    const { nombre, pin, fotoPath } = request.data || {};

    if (
      typeof nombre !== "string" ||
      !nombre.trim() ||
      nombre.trim().length > 50
    ) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre no es válido."
      );
    }

    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      throw new HttpsError(
        "invalid-argument",
        "El PIN debe tener cuatro números."
      );
    }

    if (
      typeof fotoPath !== "string" ||
      !/^perfiles\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(fotoPath)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "La ruta de la fotografía no es válida."
      );
    }

    const bucket = admin.storage().bucket();
    const [exists] = await bucket.file(fotoPath).exists();

    if (!exists) {
      throw new HttpsError(
        "failed-precondition",
        "Primero debes subir la fotografía."
      );
    }

    const salt = randomBytes(32).toString("hex");
    const pinHash = scryptSync(pin, salt, 64).toString("hex");

    const db = admin.firestore();
    const controlRef = db.collection("configuracion").doc("familia");
    const perfilRef = db.collection("perfiles").doc();

    await db.runTransaction(async (transaction) => {
      const control = await transaction.get(controlRef);
      const cantidad = control.exists
        ? control.data().cantidadPerfiles || 0
        : 0;

      if (cantidad >= 4) {
        throw new HttpsError(
          "resource-exhausted",
          "Ya se registraron los cuatro perfiles."
        );
      }

      transaction.set(perfilRef, {
        nombre: nombre.trim(),
        fotoPath,
        pinHash,
        pinSalt: salt,
        saldo: 0,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.set(
        controlRef,
        { cantidadPerfiles: cantidad + 1 },
        { merge: true }
      );
    });

    return {
      success: true,
      profileId: perfilRef.id,
      message: "Perfil registrado correctamente.",
    };
  }
);
