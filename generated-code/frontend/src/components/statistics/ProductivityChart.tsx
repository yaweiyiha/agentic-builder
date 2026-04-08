import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Define the shape of a single data point for the chart
interface ChartDataPoint {
  label: string; // Date, Week, or Month
  workSessions: number;
  breakSessions: number;
}

interface ProductivityChartProps {
  data: ChartDataPoint[];
  timeRange: 'today' | 'last7days' | 'last30days' | 'custom';
}

const ProductivityChart: React.FC<ProductivityChartProps> = ({ data, timeRange }) => {
  const formatXAxis = (tickItem: string) => {
    if (timeRange === 'last7days' || timeRange === 'last30days') {
      // For daily ranges, show only day and month
      const date = new Date(tickItem);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
    // For other ranges, return as is
    return tickItem;
  };

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] bg-[#1E293B] rounded-[8px] text-[#94A3B8]">
        No data available for this period.
      </div>
    );
  }

  return (
    <div className="w-full h-[350px] bg-[#1E293B] p-[16px] rounded-[8px] shadow-md">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="label" stroke="#94A3B8" tickFormatter={formatXAxis} />
          <YAxis stroke="#94A3B8" />
          <Tooltip
            contentStyle={{ backgroundColor: '#334155', border: 'none', borderRadius: '4px' }}
            itemStyle={{ color: '#F1F5F9' }}
            labelStyle={{ color: '#CBD5E1' }}
          />
          <Legend wrapperStyle={{ color: '#F1F5F9', paddingTop: '10px' }} />
          <Bar dataKey="workSessions" name="Work Sessions" fill="#2563eb" />
          <Bar dataKey="breakSessions" name="Break Sessions" fill="#60A5FA" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ProductivityChart;
