'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '..', '..', 'Casa-Fresca');
const productsFile = process.env.CASA_FRESCA_PRODUCTS_FILE || path.join(sourceRoot, 'Json', 'products.json');
const paymentFile = process.env.CASA_FRESCA_PAYMENT_FILE || path.join(sourceRoot, 'Json', 'pay.json');
const imagesDirectory = process.env.CASA_FRESCA_IMAGES_DIRECTORY || path.join(sourceRoot, 'Img', 'products');
const applyChanges = process.argv.includes('--apply');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name} para --apply.`);
  return value;
}

function makePublicId(filename) {
  const name = path.parse(filename).name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const suffix = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 10);
  return `${name || 'image'}-${suffix}`;
}

async function loadInputs() {
  const [productsContent, paymentContent] = await Promise.all([
    fs.readFile(productsFile, 'utf8'),
    fs.readFile(paymentFile, 'utf8')
  ]);
  const parsedProducts = JSON.parse(productsContent);
  const products = Array.isArray(parsedProducts) ? parsedProducts : parsedProducts.products;
  const payment = JSON.parse(paymentContent);

  if (!Array.isArray(products)) throw new Error('El catálogo no contiene un arreglo products.');
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
    throw new Error('La configuración de pago debe ser un objeto JSON.');
  }

  const ids = new Set();
  for (const product of products) {
    if (!product || !product.id || ids.has(String(product.id))) {
      throw new Error('El catálogo contiene un producto sin ID o IDs duplicados.');
    }
    ids.add(String(product.id));
  }

  const imageNames = [...new Set(products.flatMap(product =>
    Array.isArray(product.imagenes) ? product.imagenes.filter(Boolean) : []
  ))];
  const imagePaths = new Map();
  for (const name of imageNames) {
    const imagePath = path.resolve(imagesDirectory, name);
    if (!imagePath.startsWith(path.resolve(imagesDirectory) + path.sep)) {
      throw new Error(`La ruta de imagen no es válida: ${name}`);
    }
    await fs.access(imagePath);
    imagePaths.set(name, imagePath);
  }

  const diskFiles = await fs.readdir(imagesDirectory);
  const unreferencedImages = diskFiles.filter(name => !imagePaths.has(name));
  return { products, payment, imagePaths, unreferencedImages };
}

async function run() {
  const { products, payment, imagePaths, unreferencedImages } = await loadInputs();
  console.log(`Catálogo: ${products.length} productos; imágenes referenciadas: ${imagePaths.size}; archivos sin referencia: ${unreferencedImages.length}.`);
  if (unreferencedImages.length) {
    console.log(`Archivos sin referencia (no se subirán): ${unreferencedImages.join(', ')}`);
  }

  if (!applyChanges) {
    console.log('Vista previa únicamente. Usa --apply después de revisar y configurar las credenciales nuevas.');
    return;
  }

  const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
  const databaseUrl = requiredEnv('FIREBASE_DATABASE_URL');
  const cloudName = requiredEnv('CLOUDINARY_CLOUD_NAME');
  const productsFolder = 'products';
  const cloudinary = require('cloudinary').v2;
  const admin = require('firebase-admin');

  cloudinary.config({
    cloud_name: cloudName,
    api_key: requiredEnv('CLOUDINARY_API_KEY'),
    api_secret: requiredEnv('CLOUDINARY_API_SECRET')
  });
  const firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: databaseUrl
  }, 'catalog-migration');

  try {
    const publicIds = new Map();
    for (const [filename, imagePath] of imagePaths) {
      const publicId = makePublicId(filename);
      await cloudinary.uploader.upload(imagePath, {
        folder: productsFolder,
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        format: 'webp',
        quality: 'auto'
      });
      publicIds.set(filename, publicId);
      console.log(`Subida correcta: ${filename}`);
    }

    const productsById = {};
    for (const product of products) {
      productsById[String(product.id)] = {
        ...product,
        imagenes: (Array.isArray(product.imagenes) ? product.imagenes : [])
          .filter(Boolean)
          .map(filename => publicIds.get(filename))
      };
    }

    await firebaseApp.database().ref().update({
      products: productsById,
      pay: payment
    });
    console.log(`Importación terminada: ${products.length} productos y configuración de pago.`);
  } finally {
    await firebaseApp.delete();
  }
}

run().catch(error => {
  console.error(`Falló la migración del catálogo: ${error.message}`);
  process.exitCode = 1;
});
