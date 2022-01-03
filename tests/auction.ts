import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Auction } from "../target/types/auction";
const { SystemProgram } = anchor.web3;
import assert from "assert";
import * as spl from "@solana/spl-token";

describe("auction", () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  // const providerWallet = provider.wallet;
  const program = anchor.workspace.Auction as Program<Auction>;
  const auction = anchor.web3.Keypair.generate();
  const owner = anchor.web3.Keypair.generate();
  const purchaser = anchor.web3.Keypair.generate();
  const purchaserWithoutFunds = anchor.web3.Keypair.generate();

  const price = 9999999;
  const insufficient_amount = 1000000;
  const more_than_enough = 100000000000;

  // fill the purchaserWithoutFunds with an insufficient amount
  before(async () => {
    const signature = await program.provider.connection.requestAirdrop(
      purchaserWithoutFunds.publicKey,
      insufficient_amount
    );
    await program.provider.connection.confirmTransaction(signature);
  });
  // fill the owner with enough funds to pay for the process
  before(async () => {
    const signature = await program.provider.connection.requestAirdrop(
      owner.publicKey,
      more_than_enough
    );
    await program.provider.connection.confirmTransaction(signature);
  });

  // fill the purchaser accound with more than enough funds
  before(async () => {
    const signature = await program.provider.connection.requestAirdrop(
      purchaser.publicKey,
      more_than_enough
    );
    await program.provider.connection.confirmTransaction(signature);
  });

  it("It initializes the account and creates an auction!", async () => {
    const [mint, mintBump] = await anchor.web3.PublicKey.findProgramAddress(
      [],
      program.programId
    );

    let ourAssociatedTokens = await spl.Token.getAssociatedTokenAddress(
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      spl.TOKEN_PROGRAM_ID,
      mint,
      owner.publicKey
      // program.provider.wallet.publicKey
    );

    // Dec 12th, 2021
    let start_time = new anchor.BN(1639341245);
    // June 3rd, 2022
    let end_time = new anchor.BN(1654243024);
    // start price is in LAMPORTS
    let start_price_lamps = new anchor.BN(price);
    // Optional reserve_price
    let reserve_price = null;

    console.log("DAKEYS", {
      auction: auction.publicKey,
      owner: owner.publicKey,
      program: program.provider.wallet.publicKey,
      mint: mint,
      tokenProgramID: spl.TOKEN_PROGRAM_ID,
      associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      associatedToken: ourAssociatedTokens,
    });

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
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          mint: mint,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          // token things
          destination: ourAssociatedTokens,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        },
        signers: [owner, auction],
      }
    );

    console.log("Transaction: ", tx);
  });

  it("purchaserWithoutFunds does not have enough funds and the purchaser has more than enough", async () => {
    let noFundsBalance = await provider.connection.getBalance(
      purchaserWithoutFunds.publicKey
    );

    let purchaseBalance = await provider.connection.getBalance(
      purchaser.publicKey
    );

    assert.ok(price > noFundsBalance);
    assert.ok(price < purchaseBalance);
  });

  it("An account without enough funds cannot purchase the item", async () => {
    const [mint, mintBump] = await anchor.web3.PublicKey.findProgramAddress(
      [],
      program.programId
    );

    let balance_before = await provider.connection.getBalance(
      purchaserWithoutFunds.publicKey
    );
    const account_before = await program.account.auction.fetch(
      auction.publicKey
    );
    assert.ok(account_before.isEnded === false);

    let tx = await program.rpc.claim({
      accounts: {
        auction: auction.publicKey,
        authority: owner.publicKey,
        systemProgram: SystemProgram.programId,
        mint: mint,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        purchaser: purchaserWithoutFunds.publicKey,
      },
      signers: [owner, purchaserWithoutFunds],
    });

    let balance_after = await provider.connection.getBalance(
      purchaserWithoutFunds.publicKey
    );
    const account_after = await program.account.auction.fetch(
      auction.publicKey
    );

    console.log("account after insufficient purchase:", { account_after });

    assert.ok(account_after.isEnded === false);

    console.log(
      "NOT ENOUGH FUNDS balance before: ",
      balance_before,
      "- NOT ENOUGH FUNDS balance after: ",
      balance_after
    );
  });

  it("The price can be paid, ending the auction", async () => {
    const [mint, mintBump] = await anchor.web3.PublicKey.findProgramAddress(
      [],
      program.programId
    );
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
        authority: owner.publicKey,
        systemProgram: SystemProgram.programId,
        mint: mint,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        purchaser: purchaser.publicKey,
      },
      signers: [owner, purchaser],
    });

    let balance_after = await provider.connection.getBalance(
      purchaser.publicKey
    );
    const account_after = await program.account.auction.fetch(
      auction.publicKey
    );

    console.log("account after transation", { account_after });

    assert.ok(account_after.isEnded === true);

    console.log(
      "ENOUGH FUNDS balance before: ",
      balance_before,
      "- ENOUGH FUNDS balance after: ",
      balance_after
    );
    assert.ok(balance_before > balance_after);

    console.log("Transaction: ", tx);
  });
});
