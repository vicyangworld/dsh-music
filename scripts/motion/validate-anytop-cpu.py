#!/usr/bin/env python3
"""Isolated, non-commercial AnyTop research probe. Never part of plugin startup.

Provide an inspected upstream checkout, its research-only checkpoint/condition
file, and an official local T5-base safetensors directory. This script downloads
nothing, uses no CUDA, and never substitutes missing embeddings with zeros.
It does not implement ECHO's goal/pose/music-conditioned motion service.
"""
import argparse
import hashlib
import importlib
import json
import pickle
import re
import signal
import sys
import time
from pathlib import Path
from types import SimpleNamespace


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


class NumpyDataOnly(pickle.Unpickler):
    """The upstream condition dictionary is an object NPY. Permit only NumPy
    array/scalar reconstruction, never arbitrary pickle globals/import hooks.
    The caller also pins the full input file's SHA256 before deserializing it.
    """
    def find_class(self, module, name):
        permitted = {
            ('numpy.core.multiarray', '_reconstruct'),
            ('numpy._core.multiarray', '_reconstruct'),
            ('numpy.core.multiarray', 'scalar'),
            ('numpy._core.multiarray', 'scalar'),
            ('numpy', 'ndarray'), ('numpy', 'dtype'),
        }
        if (module, name) not in permitted:
            raise pickle.UnpicklingError(f'Unsupported data type: {module}.{name}')
        return getattr(importlib.import_module(module), name)


def normalized_joint_name(text):
    # Same joint-label normalization as official model/conditioners.py, MIT
    # source: https://github.com/Anytop2025/Anytop . No natural-language intent.
    if text.startswith('Sabrecat'):
        text = text[:-6]
    for prefix in ['BN_Bip01', 'Bip01', 'BN', 'NPC', 'jt', 'Sabrecat', 'Elk']:
        if text.startswith(prefix):
            text = text[len(prefix):]
    japanese = {'momo': 'Thigh', 'sippo': 'Tail', 'mune': 'Chest', 'hiza': 'Knee',
                'hara': 'Stomach', 'ashi': 'Leg', 'hiji': 'Elbow', 'koshi': 'Hips',
                'te': 'Hand', 'kubi': 'Neck', 'atama': 'Head', 'ago': 'Jaw', 'kata': 'Shoulder'}
    words = []
    for part in re.split('(?=[A-Z]|_)', text):
        part = re.sub(r'[\d_]+', '', part)
        if not part:
            continue
        if part in ['L', 'l']:
            words.append('Left')
        elif part in ['R', 'r']:
            words.append('Right')
        elif len(part) > 1:
            words.append(japanese.get(part, 'Tail' if part == 'Tai' else part))
    return ' '.join(words)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['source', 'checkpoint', 'condition', 'model-args', 't5-dir', 'output']:
        parser.add_argument(f'--{key}', type=Path, required=True)
    parser.add_argument('--checkpoint-sha256', required=True)
    parser.add_argument('--condition-sha256', required=True)
    parser.add_argument('--research-only', action='store_true', required=True)
    parser.add_argument('--species', default='Cat')
    parser.add_argument('--seed', type=int, default=10)
    parser.add_argument('--frames', type=int, default=40)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--time-limit', type=int, default=180)
    args = parser.parse_args()
    if not 20 <= args.frames <= 120 or not 1 <= args.threads <= 8:
        parser.error('Use 20..120 frames and 1..8 CPU threads.')
    if sha256(args.checkpoint) != args.checkpoint_sha256 or sha256(args.condition) != args.condition_sha256:
        parser.error('An input artifact does not match its pinned SHA256.')
    if args.condition.stat().st_size > 16 * 1024 * 1024:
        parser.error('Condition dictionary exceeds the research size budget.')
    if hasattr(signal, 'SIGALRM'):
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('CPU research time budget exhausted')))
        signal.alarm(max(30, min(600, args.time_limit)))

    import numpy as np
    import torch
    from transformers import T5Tokenizer, T5EncoderModel
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    sys.path.insert(0, str(args.source.resolve()))
    from utils.model_util import create_model_and_diffusion_general_skeleton
    from data_loaders.tensors import truebones_batch_collate
    from utils.rotation_conversions import rotation_6d_to_matrix_np

    with args.condition.open('rb') as stream:
        version = np.lib.format.read_magic(stream)
        header = np.lib.format.read_array_header_1_0 if version == (1, 0) else np.lib.format.read_array_header_2_0
        header(stream)
        conditions = NumpyDataOnly(stream).load().item()
    if args.species not in conditions:
        parser.error('Species has no supplied skeleton normalization.')
    body = conditions[args.species]
    n = len(body['parents'])
    config = SimpleNamespace(**json.loads(args.model_args.read_text()))
    if config.t5_name != 't5-base':
        parser.error('This probe explicitly validates the official T5-base model.')
    model, diffusion = create_model_and_diffusion_general_skeleton(config)
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True), strict=True)
    model.eval()
    print(json.dumps({'stage': 'checkpoint-loaded', 'parameters': sum(p.numel() for p in model.parameters()), 'joints': n}), flush=True)

    start = time.monotonic()
    tokenizer = T5Tokenizer(vocab_file=str(args.t5_dir / 'spiece.model'), legacy=True)
    encoder = T5EncoderModel.from_pretrained(str(args.t5_dir), use_safetensors=True, local_files_only=True).eval()
    names = [normalized_joint_name(name) for name in body['joints_names']]
    tokens = tokenizer(names, return_tensors='pt', padding=True)
    for index, name in enumerate(names):
        if not name:
            tokens['attention_mask'][index, :] = 0
    with torch.inference_mode():
        mask = tokens['attention_mask']
        encoded = encoder(**tokens).last_hidden_state
        embedded_names = ((encoded * mask.unsqueeze(-1)).sum(-2) / mask.sum(-1).clamp(min=1).unsqueeze(-1)).numpy()
    embedding_seconds = time.monotonic() - start
    del encoder, encoded
    print(json.dumps({'stage': 'joint-names-encoded', 'seconds': embedding_seconds, 'shape': list(embedded_names.shape)}), flush=True)

    # Fixed temporal mask from the reference dataset loader. No dataset code,
    # automatic downloads or BVH loaders execute in this CPU-only experiment.
    temporal = torch.zeros(args.frames + 1, args.frames + 1)
    temporal[:, 0] = 1
    margin = config.temporal_window // 2
    for index in range(args.frames + 1):
        temporal[index, max(0, index - margin):min(args.frames + 1, index + margin + 2)] = 1
    mean, std = body['mean'], body['std']
    rest = np.nan_to_num((body['tpos_first_frame'] - mean) / (std + 1e-6))
    batch = [np.zeros((args.frames, n, 13)), args.frames, body['parents'], rest, body['offsets'], temporal,
             body['joints_graph_dist'], body['joint_relations'], args.species, embedded_names, 0, mean, std, n]
    _, conditioning = truebones_batch_collate([batch])
    # Use the actual joint count rather than 143 masked padding joints. Confirm
    # one forward pass agrees with the original padded representation.
    original_batch = [*batch[:-1], 143]
    _, padded_conditioning = truebones_batch_collate([original_batch])
    probe = torch.randn(1, n, 13, args.frames)
    padded_probe = torch.zeros(1, 143, 13, args.frames)
    padded_probe[:, :n] = probe
    with torch.inference_mode():
        probe_step = torch.tensor([50])
        delta = float((model(probe, probe_step, y=conditioning['y']) - model(padded_probe, probe_step, y=padded_conditioning['y'])[:, :n]).abs().max())
    if delta > 1e-4:
        raise RuntimeError(f'Padding optimization failed parity check: {delta}')
    torch.manual_seed(args.seed)
    start = time.monotonic()
    with torch.inference_mode():
        for index, sample in enumerate(diffusion.p_sample_loop_progressive(model, (1, n, 13, args.frames), clip_denoised=False, model_kwargs=conditioning, device=torch.device('cpu'), progress=False)):
            if (index + 1) % 20 == 0:
                print(json.dumps({'stage': 'sampling', 'steps': index + 1, 'seconds': time.monotonic() - start}), flush=True)
    inference_seconds = time.monotonic() - start
    features = sample['sample'][0].permute(2, 0, 1).numpy() * std[None] + mean[None]
    if not np.isfinite(features).all():
        raise RuntimeError('The generated motion contains non-finite values.')

    # Recover world positions from the reference root-relative representation;
    # no IK or foot correction is applied. This is a skeleton research result.
    inverse_root_rotation = rotation_6d_to_matrix_np(features[:, 0, 3:9]).transpose(0, 2, 1)
    velocity = np.zeros((args.frames, 3))
    velocity[1:, [0, 2]] = features[:-1, 0][:, [9, 11]]
    root = np.cumsum(np.einsum('tij,tj->ti', inverse_root_rotation, velocity), axis=0)
    root[:, 1] = features[:, 0, 1]
    positions = np.einsum('tij,tkj->tki', inverse_root_rotation, features[:, 1:, :3])
    positions[:, :, 0] += root[:, None, 0]
    positions[:, :, 2] += root[:, None, 2]
    positions = np.concatenate([root[:, None], positions], axis=1)
    if not np.isfinite(positions).all():
        raise RuntimeError('Position recovery contains non-finite values.')
    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output / 'motion.npz', features=features, positions=positions, parents=body['parents'], offsets=body['offsets'], joint_names=np.asarray(body['joints_names']))
    movements = np.linalg.norm(np.diff(positions, axis=0), axis=-1)
    bone_lengths = np.stack([np.linalg.norm(positions[:, j] - positions[:, int(body['parents'][j])], axis=-1) for j in range(1, n)], axis=1)
    length_variation = bone_lengths.std(axis=0) / np.maximum(bone_lengths.mean(axis=0), 1e-8)
    report = {
        'experiment': 'AnyTop CPU skeleton generation', 'researchOnly': True,
        'source': 'https://github.com/Anytop2025/Anytop',
        'checkpointSource': 'https://huggingface.co/inbar2344/AnyTop',
        'checkpointSha256': args.checkpoint_sha256, 'conditionSha256': args.condition_sha256,
        'torch': torch.__version__, 'device': 'cpu', 'threads': args.threads,
        'species': args.species, 'jointCount': n, 'frames': args.frames, 'fps': 20,
        'diffusionSteps': diffusion.num_timesteps, 'seed': args.seed,
        't5EmbeddingSeconds': embedding_seconds, 'inferenceSeconds': inference_seconds,
        'paddedForwardMaxAbsDifference': delta,
        'finite': bool(np.isfinite(positions).all()),
        'meanJointDisplacementPerFrame': float(movements.mean()),
        'maxJointDisplacementPerFrame': float(movements.max()),
        'medianBoneLengthCoefficientOfVariation': float(np.median(length_variation)),
        'maxBoneLengthCoefficientOfVariation': float(length_variation.max()),
        'outputSha256': sha256(args.output / 'motion.npz'),
        'capabilitiesVerified': ['checkpoint-loading', 'topology-conditioned-sampling-on-supplied-skeleton'],
        'notVerified': ['feifei-25-joint-body', 'goal-conditioning', 'music-conditioning', 'current-pose-continuation', 'contact-correction', 'browser-runtime', 'production-quality', 'commercial-rights'],
    }
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    if hasattr(signal, 'SIGALRM'):
        signal.alarm(0)


if __name__ == '__main__':
    main()
