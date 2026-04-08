"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';

// This is a minimal QueryClientProvider for demonstration.
// In a real Next.js app, this would typically wrap your entire app in layout.tsx
const queryClient = new QueryClient();

interface LoginResponse {
  token: string; // Assuming the API returns a token on successful login
  // Add other user data if needed
}

const LoginPageContent: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [formError, setFormError] = useState<string>('');
  const router = useRouter();

  const loginMutation = useMutation<LoginResponse, Error, { email: string; password: string }>(
    async (credentials) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Invalid credentials');
      }

      return response.json();
    },
    {
      onSuccess: (data) => {
        // Store the token (e.g., in localStorage or a secure cookie)
        localStorage.setItem('authToken', data.token);
        router.push('/timer'); // Redirect to the timer page on success
      },
      onError: (error: Error) => {
        setFormError(error.message || 'An unexpected error occurred.');
      },
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(''); // Clear previous errors

    if (!email || !password) {
      setFormError('Please enter both email and password.');
      return;
    }

    loginMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#ffffff] p-[1rem]">
      <div className="w-full max-w-[400px] bg-[#ffffff] p-[2rem] rounded-[0.375rem] shadow-md border border-gray-200">
        <h1 className="text-[24px] font-bold text-center text-[#18181b] mb-[2rem]">
          Pomodoro Productivity Tracker
        </h1>

        <form onSubmit={handleSubmit}>
          <Input
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@example.com"
            required
            autoComplete="email"
          />
          <Input
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />

          {formError && (
            <p className="text-[14px] text-red-500 text-center mb-[1rem]">{formError}</p>
          )}

          <Button
            type="submit"
            className="w-full mb-[1rem]"
            isLoading={loginMutation.isLoading}
            disabled={loginMutation.isLoading}
          >
            Login
          </Button>
        </form>

        <div className="text-center text-[14px] text-[#18181b]">
          <Link href="/forgot-password" className="text-[#2563eb] hover:underline">
            Forgot Password?
          </Link>
        </div>

        <div className="text-center text-[14px] text-[#18181b] mt-[1rem]">
          Don't have an account?{' '}
          <Link href="/register" className="text-[#2563eb] hover:underline">
            Register
          </Link>
        </div>
      </div>
    </div>
  );
};

const LoginPage: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <LoginPageContent />
    </QueryClientProvider>
  );
};

export default LoginPage;
