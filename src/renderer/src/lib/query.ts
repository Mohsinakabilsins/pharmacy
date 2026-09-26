import { QueryClient, keepPreviousData, useMutation, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Channel, ChannelInput, ChannelOutput } from '@shared/contract';
import { api, ApiError, errorMessage } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError) && count < 1,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    },
    mutations: { retry: false },
  },
});

export function useApiQuery<K extends Channel>(
  channel: K,
  input?: ChannelInput<K>,
  options: Omit<UseQueryOptions<ChannelOutput<K>, ApiError>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<ChannelOutput<K>, ApiError>({
    queryKey: [channel, input ?? null],
    queryFn: () => api(channel, input),
    ...options,
  });
}

/** Channels whose results never change data — no cache invalidation needed. */
const READ_ONLY = new Set<string>(['pos.quote', 'purchases.calculate', 'auth.override', 'backup.inspect', 'backup.pickFile', 'backup.chooseDirectory', 'print.sale', 'print.return', 'print.cashSession', 'print.purchase', 'print.labels', 'print.test', 'reports.export', 'backup.showInFolder', 'auth.heartbeat', 'prescriptions.getAttachment']);

export function useApiMutation<K extends Channel>(
  channel: K,
  opts: {
    onSuccess?: (data: ChannelOutput<K>, input: ChannelInput<K>) => void;
    onError?: (err: ApiError) => void;
    success?: string | ((data: ChannelOutput<K>) => string);
    silentError?: boolean;
  } = {},
) {
  return useMutation<ChannelOutput<K>, ApiError, ChannelInput<K>>({
    mutationFn: (input) => api(channel, input),
    onSuccess: (data, input) => {
      if (!READ_ONLY.has(channel)) void queryClient.invalidateQueries();
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(data) : opts.success);
      opts.onSuccess?.(data, input);
    },
    onError: (err) => {
      if (opts.onError) opts.onError(err);
      if (!opts.silentError && err.code !== 'CANCELLED' && err.code !== 'VALIDATION') toast.error(errorMessage(err));
      if (!opts.silentError && err.code === 'VALIDATION') toast.error(err.message);
    },
  });
}
