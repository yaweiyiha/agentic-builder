'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Link from 'next/link';

const RegisterPage: React.FC = () => {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [generalError, setGeneralError] = useState<string>('');

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    if (!email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Email address is invalid';
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
    if (!confirmPassword) newErrors.confirmPassword = 'Confirm Password is required';
    if (password && confirmPassword && password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError('');
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        // Assuming successful registration also logs the user in and redirects to /timer
        router.push('/timer');
      } else {
        setGeneralError(data.error || 'Registration failed. Please try again.');
        // Specific error handling for email already exists
        if (data.error && data.error.includes('Email already exists')) {
          setErrors(prev => ({ ...prev, email: data.error }));
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      setGeneralError('Network error or server unavailable. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] p-[16px]">
      <div className="bg-[#ffffff] p-[32px] rounded-[12px] shadow-lg w-full max-w-[400px]">
        <h1 className="text-[28px] font-bold text-[#18181b] text-center mb-[32px]">
          Register for Pomodoro Tracker
        </h1>

        <form onSubmit={handleSubmit} className="space-y-[16px]">
          <Input
            label="Email"
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            error={errors.email}
            disabled={loading}
          />
          <Input
            label="Password"
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            error={errors.password}
            disabled={loading}
          />
          <Input
            label="Confirm Password"
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            error={errors.confirmPassword}
            disabled={loading}
          />

          {generalError && (
            <p className="text-[14px] text-[#ef4444] text-center">
              {generalError}
            </p>
          )}

          <Button type="submit" className="w-full" loading={loading} disabled={loading}>
            Register
          </Button>
        </form>

        <p className="mt-[24px] text-[16px] text-[#18181b] text-center">
          Already have an account?{' '}
          <Link href="/login" className="text-[#2563eb] hover:underline">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
