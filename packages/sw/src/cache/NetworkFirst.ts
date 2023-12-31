import { BaseStrategy, CACHE_TIMESTAMP_HEADER } from './BaseStrategy.js';
import type { CacheOptions, CacheableResponseOptions, NetworkFriendlyOptions } from './types.js';

/**
 * NetworkFirst strategy - prioritizes network responses, falling back to cache.
 */
export class NetworkFirst extends BaseStrategy {
  private networkTimeoutSeconds: number;
  private cacheableResponse: CacheableResponseOptions | false;

  constructor(cacheName: string, options: NetworkFriendlyOptions = {}) {
    super(cacheName, options as CacheOptions);
    this.networkTimeoutSeconds = options.networkTimeoutInSeconds ?? 10;
    this.cacheableResponse = options.cacheableResponse ?? false;
  }

  /**
   * Handles fetch requests by trying to fetch from the network first.
   * Falls back to cache if the network fails or times out.
   * @param {Request} request - The request to handle.
   * @returns {Promise<Response>} The network or cached response.
   */
  async handleRequest(request: Request): Promise<Response> {
    try {
      const res = await this.fetchWithTimeout(request);
      // If the code reaches this line, that means an error wasn't thrown
      if (await this.validateResponse(res as Response)) await this.putInCache(request, res as Response);
      return res as Response;
    } catch (error) {
      const cache = await this.openCache();
      const response = await cache.match(request);

      if (response) return response;

      throw new Error('No response received from fetch: Timeout');
    }
  }

  /**
   * Puts a response into the cache.
   * @param {Request} request - The request to cache.
   * @param {Response} response - The response to cache.
   */
  private async putInCache(request: Request, response: Response) {
    const cache = await this.openCache();
    const timestampedResponse = this.addTimestampHeader(response);
    cache.put(request, timestampedResponse);
  }

  /**
   * Adds a timestamp header to the response.
   * @param {Response} response - The original response.
   * @returns {Response} The new response with the timestamp header.
   */
  private addTimestampHeader(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.append(CACHE_TIMESTAMP_HEADER, Date.now().toString());

    const timestampedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    return timestampedResponse;
  }

  private async validateResponse(response: Response): Promise<boolean> {
    if (!this.cacheableResponse) {
      return true;
    }

    const { headers = {}, statuses = [] } = this.cacheableResponse;

    const isStatusValid = statuses.length > 0 ? statuses.includes(response.status) : true;
    const isHeaderValid =
      Object.keys(headers).length > 0
        ? Object.entries(headers).every(([key, value]) => response.headers.get(key) === value)
        : true;

    return isStatusValid && isHeaderValid;
  }

  /**
   * Fetches a request with a timeout.
   * @param {Request} request - The request to fetch.
   * @returns {Promise<Response>} The fetched response.
   */
  private async fetchWithTimeout(request: Request): Promise<unknown> {
    const timeoutSeconds = this.networkTimeoutSeconds;

    const timeoutPromise =
      timeoutSeconds !== Infinity
        ? new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(new Error(`Network timed out after ${timeoutSeconds} seconds`)),
              timeoutSeconds * 1000
            )
          )
        : null;

    if (timeoutPromise) {
      return Promise.race([fetch(request), timeoutPromise]);
    } else {
      return fetch(request);
    }
  }
}
