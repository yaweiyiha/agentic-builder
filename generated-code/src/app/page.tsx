export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <h1 className="text-4xl font-bold text-center">Welcome to Pomodoro Timer</h1>
      <p className="text-lg text-center mt-4">This is a basic Next.js application with Prisma and Tailwind CSS.</p>
      <div className="mt-8 p-6 bg-white rounded-lg shadow-md">
        <p className="text-gray-700">Start building your timer here!</p>
      </div>
    </main>
  );
}
