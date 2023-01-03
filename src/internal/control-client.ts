import {control} from '@gomomento/generated-types';
import {Header, HeaderInterceptor} from '../grpc/headers-interceptor';
import {ClientTimeoutInterceptor} from '../grpc/client-timeout-interceptor';
import {createRetryInterceptorIfEnabled} from '../grpc/retry-interceptor';
import {InvalidArgumentError, SdkError, UnknownError} from '../errors/errors';
import {Status} from '@grpc/grpc-js/build/src/constants';
import {cacheServiceErrorMapper} from '../errors/cache-service-error-mapper';
import {ChannelCredentials, Interceptor} from '@grpc/grpc-js';
import * as CreateCache from '../messages/responses/create-cache';
import * as DeleteCache from '../messages/responses/delete-cache';
import * as ListCaches from '../messages/responses/list-caches';
import * as CreateSigningKey from '../messages/responses/create-signing-key';
import * as ListSigningKeys from '../messages/responses/list-signing-keys';
import * as RevokeSigningKey from '../messages/responses/revoke-signing-key';
import {version} from '../../package.json';
import {getLogger, Logger} from '../utils/logging';
import {IdleGrpcClientWrapper} from '../grpc/idle-grpc-client-wrapper';
import {GrpcClientWrapper} from '../grpc/grpc-client-wrapper';

export interface MomentoProps {
  authToken: string;
  endpoint: string;
}

export class ControlClient {
  private readonly clientWrapper: GrpcClientWrapper<control.control_client.ScsControlClient>;
  private readonly interceptors: Interceptor[];
  private static readonly REQUEST_TIMEOUT_MS: number = 60 * 1000;
  private readonly logger: Logger;

  /**
   * @param {MomentoProps} props
   */
  constructor(props: MomentoProps) {
    this.logger = getLogger(this);
    const headers = [
      new Header('Authorization', props.authToken),
      new Header('Agent', `javascript:${version}`),
    ];
    this.interceptors = [
      new HeaderInterceptor(headers).addHeadersInterceptor(),
      ClientTimeoutInterceptor(ControlClient.REQUEST_TIMEOUT_MS),
      ...createRetryInterceptorIfEnabled(),
    ];
    this.logger.debug(
      `Creating control client using endpoint: '${props.endpoint}`
    );
    this.clientWrapper = new IdleGrpcClientWrapper({
      clientFactoryFn: () =>
        new control.control_client.ScsControlClient(
          props.endpoint,
          ChannelCredentials.createSsl()
        ),
    });
  }

  public async createCache(name: string): Promise<CreateCache.Response> {
    try {
      this.validateCacheName(name);
    } catch (err) {
      if (err instanceof SdkError) {
        return new CreateCache.Error(err);
      } else if (err instanceof Error) {
        return new CreateCache.Error(new UnknownError(err.message));
      }
    }
    this.logger.info(`Creating cache: ${name}`);
    const request = new control.control_client._CreateCacheRequest({
      cache_name: name,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return await new Promise<CreateCache.Response>((resolve, reject) => {
      this.clientWrapper.getClient().CreateCache(
        request,
        {interceptors: this.interceptors},
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (err, resp) => {
          if (err) {
            if (err.code === Status.ALREADY_EXISTS) {
              resolve(new CreateCache.AlreadyExists());
            } else {
              resolve(new CreateCache.Error(cacheServiceErrorMapper(err)));
            }
          } else {
            resolve(new CreateCache.Success());
          }
        }
      );
    });
  }

  public async deleteCache(name: string): Promise<DeleteCache.Response> {
    try {
      this.validateCacheName(name);
    } catch (err) {
      if (err instanceof SdkError) {
        return new DeleteCache.Error(err);
      } else if (err instanceof Error) {
        return new DeleteCache.Error(new UnknownError(err.message));
      }
    }
    const request = new control.control_client._DeleteCacheRequest({
      cache_name: name,
    });
    this.logger.info(`Deleting cache: ${name}`);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return await new Promise<DeleteCache.Response>((resolve, reject) => {
      this.clientWrapper.getClient().DeleteCache(
        request,
        {interceptors: this.interceptors},
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (err, resp) => {
          if (err) {
            resolve(new DeleteCache.Error(cacheServiceErrorMapper(err)));
          } else {
            resolve(new DeleteCache.Success());
          }
        }
      );
    });
  }

  public async listCaches(nextToken?: string): Promise<ListCaches.Response> {
    const request = new control.control_client._ListCachesRequest();
    request.next_token = nextToken ?? '';
    this.logger.debug("Issuing 'listCaches' request");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return await new Promise<ListCaches.Response>((resolve, reject) => {
      this.clientWrapper
        .getClient()
        .ListCaches(request, {interceptors: this.interceptors}, (err, resp) => {
          if (err) {
            resolve(new ListCaches.Error(cacheServiceErrorMapper(err)));
          } else {
            resolve(new ListCaches.Success(resp));
          }
        });
    });
  }

  public async createSigningKey(
    ttlMinutes: number,
    endpoint: string
  ): Promise<CreateSigningKey.Response> {
    try {
      this.validateTtlMinutes(ttlMinutes);
    } catch (err) {
      if (err instanceof SdkError) {
        return new CreateSigningKey.Error(err);
      } else if (err instanceof Error) {
        return new CreateSigningKey.Error(new UnknownError(err.message));
      }
    }
    this.logger.debug("Issuing 'createSigningKey' request");
    const request = new control.control_client._CreateSigningKeyRequest();
    request.ttl_minutes = ttlMinutes;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return await new Promise<CreateSigningKey.Response>((resolve, reject) => {
      this.clientWrapper
        .getClient()
        .CreateSigningKey(
          request,
          {interceptors: this.interceptors},
          (err, resp) => {
            if (err) {
              resolve(new CreateSigningKey.Error(cacheServiceErrorMapper(err)));
            } else {
              resolve(new CreateSigningKey.Success(endpoint, resp));
            }
          }
        );
    });
  }

  public async revokeSigningKey(
    keyId: string
  ): Promise<RevokeSigningKey.Response> {
    const request = new control.control_client._RevokeSigningKeyRequest();
    request.key_id = keyId;
    this.logger.debug("Issuing 'revokeSigningKey' request");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return await new Promise<RevokeSigningKey.Response>((resolve, reject) => {
      this.clientWrapper
        .getClient()
        .RevokeSigningKey(request, {interceptors: this.interceptors}, err => {
          if (err) {
            resolve(new RevokeSigningKey.Error(cacheServiceErrorMapper(err)));
          } else {
            resolve(new RevokeSigningKey.Success());
          }
        });
    });
  }

  public async listSigningKeys(
    endpoint: string,
    nextToken?: string
  ): Promise<ListSigningKeys.Response> {
    const request = new control.control_client._ListSigningKeysRequest();
    request.next_token = nextToken ?? '';
    this.logger.debug("Issuing 'listSigningKeys' request");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return await new Promise<ListSigningKeys.Response>((resolve, reject) => {
      this.clientWrapper
        .getClient()
        .ListSigningKeys(
          request,
          {interceptors: this.interceptors},
          (err, resp) => {
            if (err) {
              resolve(new ListSigningKeys.Error(cacheServiceErrorMapper(err)));
            } else {
              resolve(new ListSigningKeys.Success(endpoint, resp));
            }
          }
        );
    });
  }

  private validateCacheName(name: string) {
    if (!name.trim()) {
      throw new InvalidArgumentError('cache name must not be empty');
    }
  }

  private validateTtlMinutes(ttlMinutes: number) {
    if (ttlMinutes < 0) {
      throw new InvalidArgumentError('ttlMinutes must be positive');
    }
  }
}
