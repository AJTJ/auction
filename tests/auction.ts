import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Auction } from "../target/types/auction";
const { SystemProgram } = anchor.web3;
import assert from "assert";
import * as spl from "@solana/spl-token";

describe("auction", () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const providerWallet = provider.wallet;
  const program = anchor.workspace.Auction as Program<Auction>;
  const auction = anchor.web3.Keypair.generate();
  const owner = anchor.web3.Keypair.generate();
  const purchaser = anchor.web3.Keypair.generate();

  // fill the account with lamps
  before(async () => {
    const signature = await program.provider.connection.requestAirdrop(
      owner.publicKey,
      1000000000000
    );
    await program.provider.connection.confirmTransaction(signature);
  });

  // fill the account with lamps
  before(async () => {
    const signature = await program.provider.connection.requestAirdrop(
      purchaser.publicKey,
      1000000000000
    );
    await program.provider.connection.confirmTransaction(signature);
  });

  it("It initializes the account and creates an auction!", async () => {
    const [mint, mintBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("mint")],
      program.programId
    );
    // Dec 12th, 2021
    let start_time = new anchor.BN(1639341245);
    // January first, 2022
    let end_time = new anchor.BN(1641094445);
    // start price is in LAMPORTS
    let start_price_lamps = new anchor.BN(1000);
    // Optional reserve_price
    let reserve_price = null;

    let tx = await program.rpc.initialize(
      mintBump,
      start_time,
      end_time,
      start_price_lamps,
      reserve_price,
      {
        accounts: {
          auction: auction.publicKey,
          authority: owner.publicKey,
          systemProgram: SystemProgram.programId,
          mint: mint,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [owner, auction],
      }
    );

    console.log("Transaction: ", tx);
  });

  it("The price can be paid, ending the auction", async () => {
    const account_before = await program.account.auction.fetch(
      auction.publicKey
    );
    assert.ok(account_before.isEnded === false);

    let balance_before = await provider.connection.getBalance(
      purchaser.publicKey
    );

    let tx = await program.rpc.claim({
      accounts: {
        auction: auction.publicKey,
        authority: providerWallet.publicKey,
        purchaser: purchaser.publicKey,
        systemProgram: SystemProgram.programId,
      },
      signers: [purchaser],
    });

    let balance_after = await provider.connection.getBalance(
      purchaser.publicKey
    );
    const account_after = await program.account.auction.fetch(
      auction.publicKey
    );
    assert.ok(account_after.isEnded === true);

    assert.ok(balance_before > balance_after);

    console.log("Transaction: ", tx);
  });
});
