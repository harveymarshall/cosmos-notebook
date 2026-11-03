// Mission Control's tracker: one small Lambda, woken on a schedule (see
// infra/terraform/tracker.tf). The schedule says which jobs to run, e.g. { "jobs": ["dsn"] }.
// It saves JSON into the website bucket under live/, where the /missions/ page reads it.
// Uses only the AWS SDK built into the Lambda runtime — nothing to install.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { runJobs } from './src/run.js';

const s3 = new S3Client({});
const Bucket = process.env.SITE_BUCKET;

const write = (Key, Body, maxAge) =>
  s3.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body,
      ContentType: 'application/json; charset=utf-8',
      CacheControl: `public,max-age=${maxAge}`,
    })
  );

const read = async (Key) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket, Key }))).Body.transformToString());

export const handler = async (event = {}) => {
  if (!Bucket) throw new Error('SITE_BUCKET is not set');
  const jobs = Array.isArray(event.jobs) && event.jobs.length ? event.jobs : ['positions', 'dsn', 'news'];
  return runJobs(jobs, { read, write });
};
