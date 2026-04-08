'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import AuthFormContainer from '../components/AuthFormContainer';
import Input from '../components/Input';
import Button from '../components/Button';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});

  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/timer'); // Redirect to timer page if already logged in
    }
  }, [status, router]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string; general?: string } = {};
    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email address is invalid';
    }
    if (!password) {
      newErrors.password = 'Password is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const result = await signIn('credentials', {
        redirect: false, // Do not redirect, handle it manually
        email,
        password,
      });

      if (result?.error) {
        setErrors({ general: 'Invalid credentials. Please check your email and password.' });
      } else {
        router.push('/timer'); // Redirect to timer page on successful login
      }
    } catch (error) {
      console.error('Login error:', error);
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] font-sans text-[#18181b]">
        Loading...
      </div>
    );
  }

  return (
    <AuthFormContainer
      title="Login to Pomodoro"
      footerText="Don't have an account?"
      footerLinkHref="/register"
      footerLinkText="Register"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-[1rem]">
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          disabled={loading}
        />
        <Input
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          disabled={loading}
        />
        {errors.general && (
          <p className="text-[14px] text-red-500 text-center">{errors.general}</p>
        )}
        <Button type="submit" loading={loading} disabled={loading}>
          Login
        </Button>
      </form>
    </AuthFormContainer>
  );
};

export default LoginPage;
