import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

/**
 * Signed direct uploads to Cloudinary: the browser uploads the file straight to Cloudinary with a
 * short-lived signature from us, so the API secret never leaves the server and no file passes through Render.
 * Configured with CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>.
 */
@Injectable()
export class ImagesService {
  private readonly config = ImagesService.parse(process.env.CLOUDINARY_URL);

  static parse(url: string | undefined): CloudinaryConfig | null {
    const match = url?.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    return match ? { apiKey: match[1], apiSecret: match[2], cloudName: match[3] } : null;
  }

  /** Only photos uploaded to this project's own Cloudinary account are accepted (never an arbitrary link). */
  isOwnUpload(url: string) {
    return this.config !== null && url.startsWith(`https://res.cloudinary.com/${this.config.cloudName}/`);
  }

  status() {
    return { uploadsEnabled: this.config !== null };
  }

  signUpload(folder = 'kitchen/dishes') {
    if (!this.config) throw new ServiceUnavailableException('Image uploads are not configured (CLOUDINARY_URL is missing).');
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1').update(toSign + this.config.apiSecret).digest('hex');
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/upload`,
      apiKey: this.config.apiKey,
      folder,
      timestamp,
      signature,
    };
  }
}
