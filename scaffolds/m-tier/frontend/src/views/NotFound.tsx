import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";

export const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-9xl font-bold text-gray-900">404</h1>
          <h2 className="mt-4 text-3xl font-bold text-gray-900">
            Page not found
          </h2>
          <p className="mt-2 text-gray-600">
            Sorry, we couldn't find the page you're looking for.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            type="primary"
            onClick={() => navigate("/dashboard")}
            className="sm:w-auto"
          >
            Go to Dashboard
          </Button>
          <Button
            type="link"
            onClick={() => navigate(-1)}
            className="sm:w-auto"
          >
            Go Back
          </Button>
        </div>
        <div className="mt-12">
          <p className="text-sm text-gray-500">
            If you think this is an error, please contact support.
          </p>
        </div>
      </div>
    </div>
  );
};
