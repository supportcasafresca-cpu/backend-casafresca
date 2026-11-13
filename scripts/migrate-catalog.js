'use strict';

const crypto = require('node:crypto');
const dotenv = require('dotenv');
const fs = require('node:fs/promises');
const path = require('node:path');

const envFileIndex = process.argv.indexOf('--env-file');
const envFile = envFileIndex >= 0
  ? path.resolve(process.cwd(), process.argv[envFileIndex + 1] || '')
  : path.resolve(__dirname, '..', '.env');
const envFileResult = dotenv.config({ path: envFile });
if (envFileResult.error && envFileResult.error.code !== 'ENOENT') {
  throw envFileResult.error;
}

const sourceRoot = path.resolve(__dirname, '..', '..', 'Casa-Fresca');
const productsFile = process.env.CASA_FRESCA_PRODUCTS_FILE || path.join(sourceRoot, 'Json', 'products.json');
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

function normalizeProduct(product, imagePublicIds) {
  const disponible = product.disponibilidad !== undefined
    ? product.disponibilidad !== false
    : product.activo !== false;
  const createdAt = product.fecha_creacion || product.created_at || null;
  const updatedAt = product.fecha_actualizacion || product.modified_at || createdAt;
  const price = Number(product.precio ?? 0);
  const discount = Number(product.descuento ?? 0);
  const stock = Number(product.stock ?? 0);

  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Precio no válido para el producto ${product.id}.`);
  }
  if (!Number.isFinite(discount) || discount < 0) {
    throw new Error(`Descuento no válido para el producto ${product.id}.`);
  }
  if (!Number.isFinite(stock) || stock < 0) {
    throw new Error(`Stock no válido para el producto ${product.id}.`);
  }

  return {
    id: String(product.id),
    nombre: String(product.nombre || 'Sin nombre'),
    descripcion: String(product.descripcion || ''),
    precio: price,
    categoria: String(product.categoria || 'general'),
    stock,
    cantidad_minima: Math.max(1, Math.floor(Number(product.cantidad_minima ?? 1)) || 1),
    plazo_reposicion_dias: Math.max(0, Math.floor(Number(product.plazo_reposicion_dias ?? 0)) || 0),
    stock_seguridad_dias: Math.max(0, Math.floor(Number(product.stock_seguridad_dias ?? 0)) || 0),
    aplicar_stock: product.aplicar_stock === true,
    oferta: product.oferta === true,
    descuento: discount,
    imagenes: (Array.isArray(product.imagenes) ? product.imagenes : [])
      .filter(Boolean)
      .map(filename => imagePublicIds.get(filename) || filename),
    activo: disponible,
    disponibilidad: disponible,
    mas_vendido: product.mas_vendido === true,
    nuevo: product.nuevo === true,
    fecha_creacion: createdAt,
    fecha_actualizacion: updatedAt,
    created_at: product.created_at || createdAt,
    modified_at: product.modified_at || updatedAt
  };
}

async function loadInputs() {
  const productsContent = await fs.readFile(productsFile, 'utf8');
  const parsedProducts = JSON.parse(productsContent);
  const products = Array.isArray(parsedProducts) ? parsedProducts : parsedProducts.products;

  if (!Array.isArray(products)) throw new Error('El catálogo no contiene un arreglo products.');

  const ids = new Set();
  for (const product of products) {
    if (!product || !product.id || ids.has(String(product.id))) {
      throw new Error('El catálogo contiene un producto sin ID o IDs duplicados.');
    }
    const id = String(product.id);
    if (/[.#$/[\]]/.test(id)) {
      throw new Error(`El ID "${id}" contiene caracteres no permitidos como clave de Realtime Database.`);
    }
    if (!product.nombre || !Number.isFinite(Number(product.precio))) {
      throw new Error(`El producto ${id} necesita un nombre y un precio numérico.`);
    }
    normalizeProduct(product, new Map());
    ids.add(id);
  }

  const imageNames = [...new Set(products.flatMap(product =>
    Array.isArray(product.imagenes) ? product.imagenes.filter(Boolean) : []
  ))];
  const imagePaths = new Map();
  for (const name of imageNames) {
    if (typeof name !== 'string') {
      throw new Error(`La referencia de imagen debe ser un nombre de archivo: ${String(name)}`);
    }
    const imagePath = path.resolve(imagesDirectory, name);
    if (!imagePath.startsWith(path.resolve(imagesDirectory) + path.sep)) {
      throw new Error(`La ruta de imagen no es válida: ${name}`);
    }
    await fs.access(imagePath);
    imagePaths.set(name, imagePath);
  }

  const diskFiles = await fs.readdir(imagesDirectory);
  const unreferencedImages = diskFiles.filter(name => !imagePaths.has(name));
  return { products, imagePaths, unreferencedImages };
}

async function run() {
  if (applyChanges && envFileResult.error && envFileResult.error.code === 'ENOENT') {
    throw new Error(`No se encontró el archivo de entorno ${envFile}. Pasa --env-file <ruta> o crea backend-casafresca/.env.`);
  }

  const { products, imagePaths, unreferencedImages } = await loadInputs();
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
      productsById[String(product.id)] = normalizeProduct(product, publicIds);
    }

    await firebaseApp.database().ref('products').update(productsById);
    console.log(`Importación terminada: ${products.length} productos guardados en la RTDB principal, nodo /products.`);
  } finally {
    await firebaseApp.delete();
  }
}

run().catch(error => {
  console.error(`Falló la migración del catálogo: ${error.message}`);
  process.exitCode = 1;
});
