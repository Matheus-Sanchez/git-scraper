import { productsPath, readProducts, toSafeProductReadError } from '../src/io/products.js';

async function main() {
  try {
    const products = await readProducts();
    console.log(`Catalog validation passed for ${products.length} product(s): ${productsPath()}`);
  } catch (error) {
    console.error(`Catalog validation failed for ${productsPath()}: ${toSafeProductReadError(error)}`);
    process.exitCode = 1;
  }
}

await main();
