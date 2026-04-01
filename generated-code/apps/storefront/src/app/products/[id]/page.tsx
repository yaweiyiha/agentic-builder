import { notFound } from 'next/navigation';
import { Product } from '@/types/product';
import { ImageGallery } from '@/components/product/ImageGallery';
import { AddToCart } from '@/components/product/AddToCart';

// US-05: Configure ISR for 60-second revalidation
export const revalidate = 60;

async function getProduct(id: string): Promise<Product | null> {
  try {
    // In a production environment, this fetches from the Apollo Router Gateway
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const res = await fetch(`${apiUrl}/api/catalog/products/${id}`, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      throw new Error('Failed to fetch product');
    }

    return await res.json();
  } catch (error) {
    // Fallback mock data for demonstration purposes if API is unreachable
    console.warn(`Falling back to mock data for product ${id}`);
    return {
      id,
      name: 'Industrial Steel Widget X-200',
      description: 'High-grade industrial steel widget designed for heavy-duty manufacturing processes. Features anti-corrosive coating, precision-milled edges, and meets ISO 9001 standards. Ideal for B2B wholesale procurement.',
      sku: `WIDG-${id.substring(0, 4).toUpperCase()}-STL`,
      price: 149.99,
      currency: 'USD',
      images: [
        { url: 'https://placehold.co/800x800/f4f4f5/52525b?text=Product+Front', alt: 'Front view' },
        { url: 'https://placehold.co/800x800/f4f4f5/52525b?text=Product+Side', alt: 'Side view' },
        { url: 'https://placehold.co/800x800/f4f4f5/52525b?text=Product+Detail', alt: 'Detail view' },
      ],
      vendor: { id: 'v-123', name: 'Acme Corp Manufacturing' },
      b2bTiers: [
        { minQuantity: 10, price: 135.00 },
        { minQuantity: 50, price: 120.00 },
        { minQuantity: 100, price: 99.99 },
      ],
      inStock: true,
      stockQuantity: 500,
    };
  }
}

export default async function ProductDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const product = await getProduct(params.id);

  if (!product) {
    notFound();
  }

  return (
    <main className="container mx-auto px-4 py-8 md:py-12 max-w-7xl">
      {/* Breadcrumbs */}
      <nav className="text-sm text-zinc-500 mb-8">
        <ol className="flex items-center space-x-2">
          <li><a href="/" className="hover:text-blue-600 transition-colors">Home</a></li>
          <li><span>/</span></li>
          <li><a href="/catalog" className="hover:text-blue-600 transition-colors">Catalog</a></li>
          <li><span>/</span></li>
          <li className="text-zinc-900 font-medium truncate">{product.name}</li>
        </ol>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Left Column: Image Gallery */}
        <section>
          <ImageGallery images={product.images} />
        </section>

        {/* Right Column: Product Details */}
        <section className="flex flex-col">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded">
                {product.vendor.name}
              </span>
              <span className="text-sm text-zinc-500">SKU: {product.sku}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 mb-4">
              {product.name}
            </h1>
            <p className="text-2xl font-semibold text-zinc-900">
              ${product.price.toFixed(2)}
            </p>
          </div>

          <div className="prose prose-zinc mb-8">
            <p className="text-zinc-600 leading-relaxed">
              {product.description}
            </p>
          </div>

          {/* B2B Pricing Tiers */}
          {product.b2bTiers && product.b2bTiers.length > 0 && (
            <div className="mb-8 bg-zinc-50 rounded-lg p-4 border border-zinc-200">
              <h3 className="text-sm font-semibold text-zinc-900 mb-3 uppercase tracking-wider">
                Volume Pricing
              </h3>
              <ul className="space-y-2">
                {product.b2bTiers.map((tier, index) => (
                  <li key={index} className="flex justify-between text-sm">
                    <span className="text-zinc-600">Buy {tier.minQuantity}+</span>
                    <span className="font-medium text-zinc-900">${tier.price.toFixed(2)} / ea</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Interactive Add to Cart Component */}
          <AddToCart product={product} />

          {/* Additional Info */}
          <div className="mt-10 pt-6 border-t border-zinc-200 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-zinc-500 mb-1">Shipping</span>
              <span className="font-medium text-zinc-900">Calculated at checkout</span>
            </div>
            <div>
              <span className="block text-zinc-500 mb-1">Returns</span>
              <span className="font-medium text-zinc-900">30-day return policy</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
