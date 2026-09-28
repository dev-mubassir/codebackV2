/**
 * Main-message images: upload (authenticated) and serve (public, for Meta).
 *
 * Only JPEG and PNG, decided by MAGIC BYTES — the client's Content-Type and
 * file name are ignored. No SVG (script), no GIF, nothing else. ≤2 MB.
 * Stored as bytea; the id is a crypto.randomUUID() (unguessable).
 *
 * Served only while attached to an automation: deleting the automation
 * cascades the image away and the URL answers 404.
 */

const crypto = require('crypto');
const express = require('express');
const prisma = require('../../lib/prisma');
const log = require('./log');
const { isUuid } = require('./util');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_PER_USER = 20; // unattached uploads in the last 24h

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 'image/png' | 'image/jpeg' | null, from the first bytes only. */
function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * Route-level raw parser (the global JSON limit stays 1 MB and untouched).
 * Any Content-Type is read as bytes; the magic bytes decide.
 */
const rawImageBody = (req, res, next) =>
  express.raw({ type: () => true, limit: MAX_BYTES })(req, res, (err) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That image is larger than 2 MB.' });
    }
    if (err) return res.status(400).json({ error: "That upload couldn't be read." });
    return next();
  });

async function uploadImage(req, res) {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ error: 'Choose a JPG or PNG image.' });
  }
  if (body.length > MAX_BYTES) {
    return res.status(413).json({ error: 'That image is larger than 2 MB.' });
  }
  const contentType = detectImageType(body);
  if (!contentType) {
    return res.status(415).json({ error: 'Only JPG and PNG images are supported.' });
  }

  const pending = await prisma.autoDmImage.count({
    where: { userId: req.userId, automationId: null, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (pending >= MAX_PENDING_PER_USER) {
    return res.status(429).json({ error: 'Too many unsaved images. Save or discard an automation first.' });
  }

  const image = await prisma.autoDmImage.create({
    data: { id: crypto.randomUUID(), userId: req.userId, contentType, byteSize: body.length, data: body },
    select: { id: true, contentType: true, byteSize: true },
  });
  log.info(`image ${image.id} uploaded (${image.byteSize} bytes)`);
  return res.status(201).json(image);
}

async function serveImage(req, res) {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found.' });

  const image = await prisma.autoDmImage.findFirst({
    where: { id, automationId: { not: null } },
    select: { data: true, contentType: true, byteSize: true },
  });
  if (!image || !['image/png', 'image/jpeg'].includes(image.contentType)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Content-Length', String(image.byteSize));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="autodm-${id}.${image.contentType === 'image/png' ? 'png' : 'jpg'}"`);
  // Short enough that a deleted automation's image stops being served soon
  // from any cache; long enough to spare the database repeat fetches.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // Meta fetches it server-side; the Siffty app shows it cross-origin.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.status(200).end(Buffer.from(image.data));
}

module.exports = { detectImageType, rawImageBody, uploadImage, serveImage, MAX_BYTES };
