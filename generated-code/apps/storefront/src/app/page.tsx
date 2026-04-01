export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-secondary">
      <div className="z-10 max-w-5xl w-full items-center justify-center font-mono text-sm flex flex-col gap-4">
        <h1 className="text-4xl font-bold text-primary">AeroCommerce Storefront</h1>
        <p className="text-secondary-foreground text-lg">
          Next.js 14 App Router - Headless B2B2C E-commerce
        </p>
        <button className="mt-4 px-6 py-2 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors">
          Explore Catalog
        </button>
      </div>
    </main>
  );
}
