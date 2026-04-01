import { useQuery } from '@tanstack/react-query';
import { PaginatedProducts, GetProductsVariables } from '../types/catalog';

const GET_PRODUCTS_QUERY = `
  query GetProducts($page: Int!, $limit: Int!, $search: String, $status: String) {
    products(page: $page, limit: $limit, search: $search, status: $status) {
      items {
        id
        name
        sku
        price
        stock
        status
        createdAt
        vendor {
          id
          name
        }
      }
      total
      page
      totalPages
    }
  }
`;

const fetchProducts = async (variables: GetProductsVariables): Promise<PaginatedProducts> => {
  const endpoint = import.meta.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql';
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 'Authorization': `Bearer ${token}` // Assuming auth is handled via interceptor or context in a real app
    },
    body: JSON.stringify({
      query: GET_PRODUCTS_QUERY,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch products from gateway');
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(json.errors[0].message || 'GraphQL Error');
  }

  return json.data.products;
};

export const useProducts = (variables: GetProductsVariables) => {
  return useQuery({
    queryKey: ['products', variables],
    queryFn: () => fetchProducts(variables),
    placeholderData: (previousData) => previousData, // Keeps previous data while fetching new pages
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
