"use client";

import { useState, useEffect } from "react";
import { loadStripe, StripeElementsOptions } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { ShieldCheck, ShoppingBag } from "lucide-react";
import CheckoutForm from "@/components/CheckoutForm";

// Initialize Stripe outside of component render to avoid recreating Stripe object
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "pk_test_mock_key"
);

export default function CheckoutPage() {
  const [clientSecret, setClientSecret] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Simulate fetching the client_secret from the Cart/Checkout Service
    const fetchPaymentIntent = async () => {
      try {
        // In a real implementation, this would be a call to your API Gateway / Cart Service
        // const response = await fetch("/api/checkout/create-payment-intent", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify({ cartId: "current-cart-id" }),
        // });
        // const data = await response.json();
        // setClientSecret(data.clientSecret);

        // Mocking the network delay and response for demonstration
        setTimeout(() => {
          setClientSecret("pi_mock_secret_12345_secret_mock");
          setIsLoading(false);
        }, 1000);
      } catch (error) {
        console.error("Failed to initialize checkout:", error);
        setIsLoading(false);
      }
    };

    fetchPaymentIntent();
  }, []);

  const options: StripeElementsOptions = {
    clientSecret,
    appearance: {
      theme: "stripe",
      variables: {
        colorPrimary: "#2563eb", // blue-600
        colorBackground: "#ffffff",
        colorText: "#18181b", // zinc-900
        colorDanger: "#ef4444",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        spacingUnit: "4px",
        borderRadius: "8px",
      },
    },
  };

  return (
    <div className="min-h-screen bg-zinc-50 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-zinc-900">Secure Checkout</h1>
          <div className="flex items-center text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-sm font-medium">
            <ShieldCheck className="w-4 h-4 mr-2" />
            SSL Encrypted
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Payment Section */}
          <div className="flex-1 order-2 lg:order-1">
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-zinc-200">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">
                Payment Details
              </h2>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-64 space-y-4">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                  <p className="text-zinc-500 text-sm">
                    Initializing secure payment...
                  </p>
                </div>
              ) : clientSecret ? (
                <Elements options={options} stripe={stripePromise}>
                  <CheckoutForm />
                </Elements>
              ) : (
                <div className="text-center text-red-600 py-8">
                  Failed to load payment details. Please try again.
                </div>
              )}
            </div>
          </div>

          {/* Order Summary Sidebar */}
          <div className="w-full lg:w-96 order-1 lg:order-2">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-200 sticky top-6">
              <div className="flex items-center mb-4">
                <ShoppingBag className="w-5 h-5 text-zinc-400 mr-2" />
                <h2 className="text-lg font-semibold text-zinc-900">
                  Order Summary
                </h2>
              </div>
              
              <div className="divide-y divide-zinc-100">
                {/* Mock Cart Items */}
                <div className="py-4 flex justify-between">
                  <div className="flex gap-4">
                    <div className="w-16 h-16 bg-zinc-100 rounded-md flex-shrink-0"></div>
                    <div>
                      <h3 className="text-sm font-medium text-zinc-900">Premium Wireless Headphones</h3>
                      <p className="text-sm text-zinc-500">Qty: 1</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-zinc-900">$299.00</span>
                </div>
                
                <div className="py-4 flex justify-between">
                  <div className="flex gap-4">
                    <div className="w-16 h-16 bg-zinc-100 rounded-md flex-shrink-0"></div>
                    <div>
                      <h3 className="text-sm font-medium text-zinc-900">Ergonomic Keyboard</h3>
                      <p className="text-sm text-zinc-500">Qty: 1</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-zinc-900">$129.00</span>
                </div>
              </div>

              <div className="border-t border-zinc-200 pt-4 mt-4 space-y-3">
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>Subtotal</span>
                  <span>$428.00</span>
                </div>
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>Shipping</span>
                  <span>Free</span>
                </div>
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>Tax</span>
                  <span>$34.24</span>
                </div>
                <div className="flex justify-between text-base font-bold text-zinc-900 pt-3 border-t border-zinc-100">
                  <span>Total</span>
                  <span>$462.24</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
